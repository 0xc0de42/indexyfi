from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from aiohttp import ClientError, ClientSession, ClientWebSocketResponse, WSMsgType
from returns.maybe import Maybe, Nothing, Some
from returns.result import Failure, Result, Success


class WebSocketErrorCode(StrEnum):
    CONNECT = "connect_failed"
    SEND = "send_failed"
    RECEIVE = "receive_failed"
    CLOSE = "close_failed"
    FRAME_TYPE = "invalid_frame_type"


@dataclass(frozen=True, slots=True)
class WebSocketError:
    code: WebSocketErrorCode
    message: str


class WebSocketConnection:
    def __init__(self, session: ClientSession, socket: ClientWebSocketResponse) -> None:
        self._session = session
        self._socket = socket

    async def send(self, text: str) -> Result[None, WebSocketError]:
        try:
            await self._socket.send_str(text)
            return Success(None)
        except (ClientError, OSError, RuntimeError):
            return Failure(WebSocketError(WebSocketErrorCode.SEND, "WebSocket send failed"))

    async def receive(self) -> Result[Maybe[str], WebSocketError]:
        try:
            while True:
                frame = await self._socket.receive()
                if frame.type == WSMsgType.TEXT:
                    data: object = frame.data
                    if isinstance(data, str):
                        return Success(Some(data))
                    return Failure(WebSocketError(WebSocketErrorCode.FRAME_TYPE, "Expected text"))
                if frame.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING):
                    return Success(Nothing)
                if frame.type == WSMsgType.ERROR:
                    return Failure(
                        WebSocketError(WebSocketErrorCode.RECEIVE, "WebSocket receive failed")
                    )
                if frame.type == WSMsgType.BINARY:
                    return Failure(
                        WebSocketError(WebSocketErrorCode.FRAME_TYPE, "Unexpected binary frame")
                    )
        except (ClientError, OSError, RuntimeError):
            return Failure(WebSocketError(WebSocketErrorCode.RECEIVE, "WebSocket receive failed"))

    async def close(self) -> Result[None, WebSocketError]:
        try:
            try:
                await self._socket.close()
            finally:
                await self._session.close()
            return Success(None)
        except (ClientError, OSError, RuntimeError):
            return Failure(WebSocketError(WebSocketErrorCode.CLOSE, "WebSocket close failed"))


async def connect(
    url: str, params: Mapping[str, str]
) -> Result[WebSocketConnection, WebSocketError]:
    session = ClientSession()
    opened = False
    try:
        socket = await session.ws_connect(url, params=params, autoping=True)
        opened = True
        return Success(WebSocketConnection(session, socket))
    except (ClientError, OSError, ValueError, RuntimeError):
        # Never propagate an exception containing the authenticated URL.
        return Failure(WebSocketError(WebSocketErrorCode.CONNECT, "WebSocket connection failed"))
    finally:
        if not opened:
            await session.close()


__all__ = [
    "WebSocketErrorCode",
    "WebSocketError",
    "WebSocketConnection",
    "connect",
]
