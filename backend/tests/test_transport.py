import asyncio

from aiohttp import web
from ind_ws.client import WebSocketErrorCode, connect
from returns.maybe import Nothing, Some
from returns.result import Failure, Success


def test_local_websocket() -> None:
    async def run() -> None:
        async def handler(request: web.Request) -> web.WebSocketResponse:
            assert request.query["apiKey"] == "fixture-only"
            socket = web.WebSocketResponse()
            await socket.prepare(request)
            message = await socket.receive_str()
            await socket.send_str(message)
            await socket.close()
            return socket

        app = web.Application()
        app.router.add_get("/ws", handler)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        try:
            port = runner.addresses[0][1]
            result = await connect(f"ws://127.0.0.1:{port}/ws", {"apiKey": "fixture-only"})
            assert isinstance(result, Success)
            socket = result.unwrap()
            try:
                assert await socket.send("hello") == Success(None)
                assert await socket.receive() == Success(Some("hello"))
                assert await socket.receive() == Success(Nothing)
            finally:
                assert await socket.close() == Success(None)
        finally:
            await runner.cleanup()

    asyncio.run(run())


def test_connection_error_does_not_leak_key() -> None:
    async def run() -> None:
        result = await connect("not-a-url", {"apiKey": "fixture-only"})
        assert isinstance(result, Failure)
        assert result.failure().code == WebSocketErrorCode.CONNECT
        assert "fixture-only" not in repr(result)

    asyncio.run(run())
