"""Narrow untrusted library values without casts or dynamic domain types."""

from typing import TypeGuard


def is_object(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(isinstance(key, str) for key in value)


def is_array(value: object) -> TypeGuard[list[object]]:
    return isinstance(value, list)


__all__ = [
    "is_object",
    "is_array",
]
