import ast
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from ind_core.boundary import is_array, is_object
from ind_core.models import AssetId, AssetPrice, FeedId, PriceSnapshot
from ind_server.serialization import snapshot_json


def test_untrusted_container_narrowing() -> None:
    assert is_object({"a": 1})
    assert not is_object({1: "a"})
    assert not is_object([])
    assert is_array([1, "x"])
    assert not is_array((1, 2))


def test_exact_json_decimal() -> None:
    at = datetime(2026, 1, 1, tzinfo=UTC)
    price = AssetPrice(AssetId("x"), FeedId(1), Decimal("1.000000000000000001"), 3)
    assert snapshot_json(PriceSnapshot(at, (price,))) == {
        "snapshot_at": at.isoformat(),
        "prices": [
            {"asset_id": "x", "feed_id": 1, "price": "1.000000000000000001", "source_timestamp": 3}
        ],
    }


def test_production_source_conventions() -> None:
    root = Path(__file__).resolve().parents[1]
    for path in sorted(root.glob("packages/*/src/*/*.py")) + sorted(
        root.glob("services/*/src/*/*.py")
    ):
        tree = ast.parse(path.read_text(), feature_version=(3, 12))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute):
                    assert node.func.attr not in {"unwrap", "failure"}, path
                    if node.func.attr in {"getenv", "dotenv_values"}:
                        assert path.parent.name == "ind_config", path
                if isinstance(node.func, ast.Name):
                    assert node.func.id != "cast", path
                    if node.func.id == "dotenv_values":
                        assert path.parent.name == "ind_config", path
            if isinstance(node, ast.Name) and node.id == "Any":
                raise AssertionError(f"Explicit Any in {path}")
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
                assert not any(
                    isinstance(part, ast.Constant) and part.value is None
                    for part in (node.left, node.right)
                ), path
