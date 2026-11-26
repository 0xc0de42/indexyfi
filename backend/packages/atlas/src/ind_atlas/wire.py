import json
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from ind_core.boundary import is_object
from ind_core.models import FeedChannel, FeedId, PriceObservation, SelectedAsset
from returns.result import Failure, Result, Success


class WireErrorCode(StrEnum):
    SUBSCRIPTION = "invalid_subscription"
    JSON = "invalid_json"
    ENVELOPE = "invalid_envelope"
    HEX = "invalid_hex"
    RECORD_COUNT = "invalid_record_count"


@dataclass(frozen=True, slots=True)
class WireError:
    code: WireErrorCode
    message: str


# Atlas acknowledges an oversized SUBSCRIPTION (66 channels) with code 0 and an empty
# msg, then streams nothing. 50 per message was verified to work; batch well below it.
MAX_SUBSCRIPTION_CHANNELS = 20


def subscription(assets: Sequence[SelectedAsset]) -> Result[tuple[str, ...], WireError]:
    """Subscription messages for one socket, each within the Atlas channel limit."""
    params = [
        f"modix@{'auth' if a.channel == FeedChannel.PUBLIC else 'private'}.price@{a.feed_id.value}"
        for a in assets
    ]
    if not params or len({a.feed_id for a in assets}) != len(assets):
        return Failure(WireError(WireErrorCode.SUBSCRIPTION, "Empty or duplicate subscription"))
    return Success(
        tuple(
            json.dumps(
                {"method": "SUBSCRIPTION", "params": params[i : i + MAX_SUBSCRIPTION_CHANNELS]},
                separators=(",", ":"),
            )
            for i in range(0, len(params), MAX_SUBSCRIPTION_CHANNELS)
        )
    )


def hex_field(value: object) -> Result[bytes, WireError]:
    if not isinstance(value, str):
        return Failure(WireError(WireErrorCode.HEX, "Expected hex string"))
    text = value.removeprefix("0x")
    if len(text) % 2 or any(c not in "0123456789abcdefABCDEF" for c in text):
        return Failure(WireError(WireErrorCode.HEX, "Invalid hex"))
    return Success(bytes.fromhex(text))


def decode(frame: str) -> Result[tuple[PriceObservation, ...], WireError]:
    try:
        envelope: object = json.loads(frame)
        if not is_object(envelope):
            return Failure(WireError(WireErrorCode.ENVELOPE, "Expected JSON object"))
        data: object = envelope.get("d")
        if isinstance(data, str):
            data = json.loads(data)
    except json.JSONDecodeError:
        return Failure(WireError(WireErrorCode.JSON, "Malformed JSON"))
    if not is_object(data) or not {"payload", "signature", "magicMarker"}.intersection(data):
        return Success(())  # control frame, not a price observation
    match (
        hex_field(data.get("payload")),
        hex_field(data.get("signature")),
        hex_field(data.get("magicMarker")),
    ):
        case (Success(payload), Success(signature), Success(marker)):
            if not payload or len(signature) != 65 or marker != b"\x70\x96":
                return Failure(WireError(WireErrorCode.ENVELOPE, "Invalid signed envelope"))
        case (Failure(error), _, _) | (_, Failure(error), _) | (_, _, Failure(error)):
            return Failure(error)
        case _:
            raise AssertionError("Unexpected Result variant")
    count = payload[-1]
    if len(payload) != 20 * count + 1:
        return Failure(WireError(WireErrorCode.RECORD_COUNT, "Invalid record count"))
    observations: list[PriceObservation] = []
    for i in range(count):
        record = payload[i * 20 : (i + 1) * 20]
        raw = int.from_bytes(record[4:14], "big")
        observations.append(
            PriceObservation(
                FeedId(int.from_bytes(record[:4], "big")),
                Decimal(f"{raw}e-18"),
                int.from_bytes(record[14:], "big"),
            )
        )
    return Success(tuple(observations))


__all__ = [
    "WireErrorCode",
    "WireError",
    "MAX_SUBSCRIPTION_CHANNELS",
    "subscription",
    "decode",
]
