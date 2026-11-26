import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum

from ind_core.models import PriceObservation, SelectedAsset
from ind_ws.client import WebSocketConnection, WebSocketErrorCode, connect
from returns.maybe import Nothing, Some
from returns.result import Failure, Result, Success

from ind_atlas.protocol import decode_message
from ind_atlas.wire import subscription

log = logging.getLogger("atlas")


class CollectorErrorCode(StrEnum):
    SUBSCRIPTION = "subscription_failed"
    CONNECTION = "connection_failed"
    SEND = "send_failed"
    RECEIVE = "receive_failed"
    CLOSE = "close_failed"


@dataclass(frozen=True, slots=True)
class CollectorError:
    code: CollectorErrorCode
    message: str


async def _receive(
    socket: WebSocketConnection,
    messages: tuple[str, ...],
    apply: Callable[[tuple[PriceObservation, ...]], None],
) -> Result[None, CollectorError]:
    for message in messages:
        match await socket.send(message):
            case Failure(error):
                return Failure(CollectorError(CollectorErrorCode.SEND, error.message))
    log.info("WebSocket connected; subscription sent in %d message(s)", len(messages))
    while True:
        match await socket.receive():
            case Failure(error) if error.code == WebSocketErrorCode.FRAME_TYPE:
                log.warning("Discarded non-text Atlas frame: %s", error.code)
            case Failure(error):
                return Failure(CollectorError(CollectorErrorCode.RECEIVE, error.message))
            case Success(Some(frame)):
                match decode_message(frame):
                    case Success(observations):
                        if observations:
                            log.debug("Atlas frame with %d observations", len(observations))
                            apply(observations)
                    case Failure(error):
                        log.warning("Discarded malformed Atlas frame: %s", error.code)
            case Success(value) if value is Nothing:
                return Success(None)
            case _:
                raise AssertionError("Unexpected Result/Maybe variant")


async def collect(
    url: str,
    api_key: str,
    assets: Sequence[SelectedAsset],
    apply: Callable[[tuple[PriceObservation, ...]], None],
) -> Result[None, CollectorError]:
    match subscription(assets):
        case Failure(error):
            return Failure(CollectorError(CollectorErrorCode.SUBSCRIPTION, error.message))
        case Success(messages):
            pass
        case _:
            raise AssertionError("Unexpected Result variant")
    # The URL is validated by ind_config to carry no credentials; the key is a separate param.
    log.info("Connecting to Atlas %s with %d feeds", url, len(assets))
    match await connect(url, {"apiKey": api_key}):
        case Failure(error):
            return Failure(CollectorError(CollectorErrorCode.CONNECTION, error.message))
        case Success(socket):
            pass
        case _:
            raise AssertionError("Unexpected Result variant")
    try:
        result = await _receive(socket, messages, apply)
    finally:
        closed = await socket.close()
        log.info("Atlas receiver stopped; cached values retained")
    match closed:
        case Failure(error):
            if isinstance(result, Success):
                return Failure(CollectorError(CollectorErrorCode.CLOSE, error.message))
    return result


__all__ = [
    "CollectorErrorCode",
    "CollectorError",
    "collect",
]
