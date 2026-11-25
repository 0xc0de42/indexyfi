from ind_core.models import PriceObservation
from returns.result import Result

from ind_atlas.wire import WireError, decode

# One error type for structural wire decoding; no redundant exception wrapper.
DecodeError = WireError


def decode_message(frame: str) -> Result[tuple[PriceObservation, ...], DecodeError]:
    return decode(frame)


__all__ = [
    "DecodeError",
    "decode_message",
]
