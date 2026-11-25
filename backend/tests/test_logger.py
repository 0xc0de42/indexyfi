import logging

from ind_logger.setup import UTCFormatter


def test_utc_milliseconds() -> None:
    record = logging.LogRecord("atlas", logging.INFO, "test", 1, "connected", (), None)
    record.created = 0.125
    record.msecs = 125
    formatter = UTCFormatter(
        "%(asctime)s.%(msecs)03dZ %(name)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    assert formatter.format(record) == "1970-01-01 00:00:00.125Z atlas connected"
