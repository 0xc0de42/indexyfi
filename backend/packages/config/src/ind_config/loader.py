import os
import tomllib
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values
from ind_core.boundary import is_object
from returns.result import Failure, Result, Success


class ConfigErrorCode(StrEnum):
    READ_FAILED = "read_failed"
    INVALID_TOML = "invalid_toml"
    MISSING_SECRET = "missing_secret"
    INVALID_FIELD = "invalid_field"


@dataclass(frozen=True, slots=True)
class ConfigError:
    code: ConfigErrorCode
    message: str


@dataclass(frozen=True, slots=True)
class Secrets:
    atlas_api_key: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class LoggerConfig:
    level: str
    colors: bool
    status_interval_seconds: int


@dataclass(frozen=True, slots=True)
class ServerConfig:
    host: str
    port: int
    frontend_origin: str


@dataclass(frozen=True, slots=True)
class AtlasWsConfig:
    url: str


@dataclass(frozen=True, slots=True)
class AtlasConfig:
    ws: AtlasWsConfig


@dataclass(frozen=True, slots=True)
class AssetsConfig:
    registry: Path
    candidates: Path
    python_module: Path


@dataclass(frozen=True, slots=True)
class SnapshotConfig:
    interval_seconds: int


@dataclass(frozen=True, slots=True)
class HistoryConfig:
    directory: Path
    persist_interval_seconds: int


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    secrets: Secrets = field(repr=False)
    logger: LoggerConfig
    server: ServerConfig
    atlas: AtlasConfig
    assets: AssetsConfig
    snapshot: SnapshotConfig
    history: HistoryConfig


def load_config(path: Path) -> Result[RuntimeConfig, ConfigError]:
    try:
        with path.open("rb") as stream:
            raw: object = tomllib.load(stream)
        secrets = dotenv_values(path.parent / ".env")
    except (tomllib.TOMLDecodeError, UnicodeError):
        return Failure(ConfigError(ConfigErrorCode.INVALID_TOML, "Invalid configuration text"))
    except OSError:
        return Failure(ConfigError(ConfigErrorCode.READ_FAILED, "Cannot read configuration"))
    key = os.environ.get("IND_ATLAS_API_KEY") or secrets.get("IND_ATLAS_API_KEY")
    if not key:
        return Failure(ConfigError(ConfigErrorCode.MISSING_SECRET, "IND_ATLAS_API_KEY is missing"))
    return parse_config(raw, path.parent, Secrets(key))


def parse_config(raw: object, base: Path, secrets: Secrets) -> Result[RuntimeConfig, ConfigError]:
    invalid = ConfigErrorCode.INVALID_FIELD
    if not is_object(raw):
        return Failure(ConfigError(invalid, "Expected TOML root table"))
    logger, server, atlas = raw.get("logger"), raw.get("server"), raw.get("atlas")
    assets, snapshot, history = raw.get("assets"), raw.get("snapshot"), raw.get("history")
    if not is_object(logger) or not is_object(server) or not is_object(atlas):
        return Failure(ConfigError(invalid, "Missing logger, server or atlas table"))
    if not is_object(assets) or not is_object(snapshot) or not is_object(history):
        return Failure(ConfigError(invalid, "Missing assets, snapshot or history table"))
    ws = atlas.get("ws")
    if not is_object(ws):
        return Failure(ConfigError(invalid, "Missing atlas.ws table"))
    level, colors = logger.get("level"), logger.get("colors")
    if not isinstance(level, str) or level not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        return Failure(ConfigError(invalid, "Invalid logger.level"))
    if not isinstance(colors, bool):
        return Failure(ConfigError(invalid, "Invalid logger.colors"))
    status = logger.get("status_interval_seconds", 10)
    if type(status) is not int or status < 0:
        return Failure(ConfigError(invalid, "Invalid logger.status_interval_seconds"))
    host, port, origin = server.get("host"), server.get("port"), server.get("frontend_origin")
    if not isinstance(host, str) or not host or not isinstance(origin, str):
        return Failure(ConfigError(invalid, "Invalid server host/origin"))
    if type(port) is not int or not 1 <= port <= 65535:
        return Failure(ConfigError(invalid, "Invalid server.port"))
    url = ws.get("url")
    if not isinstance(url, str):
        return Failure(ConfigError(invalid, "Invalid atlas.ws.url"))
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme not in ("ws", "wss")
            or not parsed.hostname
            or parsed.query
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            return Failure(
                ConfigError(invalid, "Expected WebSocket URL without credentials or query")
            )
    except ValueError:
        return Failure(ConfigError(invalid, "Invalid atlas.ws.url"))
    registry = assets.get("registry")
    candidates = assets.get("candidates")
    python_module = assets.get("python_module")
    directory = history.get("directory")
    if (
        not isinstance(registry, str)
        or not isinstance(candidates, str)
        or not isinstance(python_module, str)
        or not isinstance(directory, str)
    ):
        return Failure(
            ConfigError(invalid, "Expected registry, candidates, Python module and history paths")
        )
    interval, persist = snapshot.get("interval_seconds"), history.get("persist_interval_seconds")
    if type(interval) is not int or interval != 1 or type(persist) is not int or persist != 60:
        return Failure(ConfigError(invalid, "Snapshot/history intervals must be 1/60 seconds"))
    return Success(
        RuntimeConfig(
            secrets,
            LoggerConfig(level, colors, status),
            ServerConfig(host, port, origin),
            AtlasConfig(AtlasWsConfig(url)),
            AssetsConfig(base / registry, base / candidates, base / python_module),
            SnapshotConfig(interval),
            HistoryConfig(base / directory, persist),
        )
    )


__all__ = [
    "ConfigErrorCode",
    "ConfigError",
    "Secrets",
    "LoggerConfig",
    "ServerConfig",
    "AtlasWsConfig",
    "AtlasConfig",
    "AssetsConfig",
    "SnapshotConfig",
    "HistoryConfig",
    "RuntimeConfig",
    "load_config",
    "parse_config",
]
