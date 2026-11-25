"""Shared synthetic wire fixtures; never contain provider credentials."""

import json


def frame(records: list[tuple[int, int, int]], *, nested: bool = False) -> str:
    payload = b"".join(
        feed.to_bytes(4, "big") + price.to_bytes(10, "big") + ts.to_bytes(6, "big")
        for feed, price, ts in records
    ) + bytes([len(records)])
    data = {"payload": payload.hex(), "signature": "00" * 65, "magicMarker": "7096"}
    return json.dumps({"d": json.dumps(data) if nested else data})
