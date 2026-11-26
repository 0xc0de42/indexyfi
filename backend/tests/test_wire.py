import json
from decimal import Decimal, localcontext

import pytest
from ind_atlas.wire import MAX_SUBSCRIPTION_CHANNELS, WireErrorCode, decode, subscription
from ind_core.models import AssetId, FeedChannel, FeedId, SelectedAsset
from returns.result import Failure, Success

from tests.fixtures import frame


@pytest.mark.parametrize("nested", [False, True])
def test_decode(nested: bool) -> None:
    with localcontext() as ctx:
        ctx.prec = 6
        result = decode(frame([(12, 2**80 - 1, 123), (3, 1, 999)], nested=nested))
    assert isinstance(result, Success)
    observations = result.unwrap()  # assert before unwrapping in tests only
    assert observations[0].price == Decimal("1208925.819614629174706175")
    assert observations[1].price == Decimal("0.000000000000000001")
    assert observations[0].feed_id == FeedId(12)
    assert observations[1].source_timestamp == 999


@pytest.mark.parametrize(
    "raw",
    [
        "bad json",
        '{"d":{"payload":"xx"}}',
        '{"d":{"payload":"01","signature":"00","magicMarker":"7096"}}',
    ],
)
def test_malformed(raw: str) -> None:
    assert isinstance(decode(raw), Failure)


def test_control_and_count() -> None:
    assert decode('{"event":"ack"}') == Success(())
    assert decode(frame([])) == Success(())
    raw = json.loads(frame([(1, 2, 3)]))
    raw["d"]["payload"] = raw["d"]["payload"][:-2] + "02"
    result = decode(json.dumps(raw))
    assert isinstance(result, Failure)
    assert result.failure().code == WireErrorCode.RECORD_COUNT


def test_subscription() -> None:
    assets = (
        SelectedAsset(AssetId("a"), "A", FeedId(12), FeedChannel.PUBLIC),
        SelectedAsset(AssetId("b"), "B", FeedId(14), FeedChannel.PRIVATE),
    )
    result = subscription(assets)
    assert isinstance(result, Success)
    assert [json.loads(m) for m in result.unwrap()] == [
        {"method": "SUBSCRIPTION", "params": ["modix@auth.price@12", "modix@private.price@14"]}
    ]
    assert isinstance(subscription((assets[0], assets[0])), Failure)
    assert isinstance(subscription(()), Failure)


def test_subscription_batches_within_atlas_channel_limit() -> None:
    assets = tuple(
        SelectedAsset(AssetId(f"a{i}"), f"A{i}", FeedId(100 + i), FeedChannel.PUBLIC)
        for i in range(66)
    )
    messages = [json.loads(m) for m in subscription(assets).unwrap()]
    assert [len(m["params"]) for m in messages] == [20, 20, 20, 6]
    assert all(len(m["params"]) <= MAX_SUBSCRIPTION_CHANNELS for m in messages)
    assert [p for m in messages for p in m["params"]] == [
        f"modix@auth.price@{100 + i}" for i in range(66)
    ]
