import logging
import time

from rich.console import Console
from rich.logging import RichHandler


class UTCFormatter(logging.Formatter):
    converter = staticmethod(time.gmtime)


def configure(level: str, colors: bool) -> None:
    handler = RichHandler(
        console=Console(stderr=True, no_color=not colors),
        show_time=False,
        show_level=True,
        show_path=False,
        rich_tracebacks=False,
        markup=False,
    )
    handler.setFormatter(
        UTCFormatter("%(asctime)s.%(msecs)03dZ %(name)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    )
    logging.basicConfig(level=level, handlers=[handler], force=True)
    logging.getLogger("aiohttp.access").disabled = True


__all__ = [
    "UTCFormatter",
    "configure",
]
