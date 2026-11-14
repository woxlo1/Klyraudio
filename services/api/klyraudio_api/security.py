"""Local-only request validation and filesystem containment."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import Paths, allow_lan

LOCAL_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1", "testserver"}


def hostname_from_header(host: str) -> str:
    """Extract the host name and reject malformed bracketed literals.

    HTTP requires IPv6 literals in brackets. A value such as ``[::1].evil`` must
    not be reduced to ``::1`` by ignoring the suffix.
    """
    value = (host or "").strip().lower()
    if not value:
        return ""
    if value.startswith("["):
        end = value.find("]")
        if end == -1:
            return value
        address = value[1:end]
        rest = value[end + 1 :]
        if rest and (not rest.startswith(":") or not rest[1:].isdigit()):
            return value
        return address
    if value.count(":") > 1:
        return value
    if ":" in value:
        name, _, port = value.rpartition(":")
        return name if port.isdigit() else value
    return value


class LocalOnlyMiddleware(BaseHTTPMiddleware):
    """Reject DNS-rebinding hosts and non-local browser origins.

    This augments, but does not replace, binding the socket to loopback. LAN mode
    is an explicit opt-in environment setting and still requires an Origin check.
    """

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if not allow_lan():
            hostname = hostname_from_header(request.headers.get("host") or "")
            if hostname not in ALLOWED_HOSTS:
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "host_not_allowed",
                            "message": "Klyraudio accepts requests only from a local host.",
                            "details": {},
                            "remediation": None,
                        }
                    },
                )
        origin = request.headers.get("origin")
        if origin and origin != "null" and not LOCAL_ORIGIN.match(origin):
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "origin_not_allowed",
                        "message": "This origin is not allowed to access the local Klyraudio API.",
                        "details": {},
                        "remediation": None,
                    }
                },
            )
        return await call_next(request)


def resolve_within(root: Path, candidate: Path) -> Path:
    root_resolved = root.resolve()
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise PermissionError("The path is outside the managed data directory.") from exc
    return resolved


def resolve_managed(paths: Paths, relative_path: str) -> Path:
    if not relative_path or Path(relative_path).is_absolute():
        raise PermissionError("Asset paths must be relative to the Klyraudio data directory.")
    resolved = resolve_within(paths.data_dir, paths.data_dir / relative_path)
    allowed = [root.resolve() for root in paths.allowed_roots()]
    if not any(_is_relative_to(resolved, root) for root in allowed):
        raise PermissionError("The path is outside Klyraudio's managed folders.")
    return resolved


def ensure_allowed_existing(paths: Paths, path: Path) -> Path:
    resolved = path.resolve()
    allowed = [root.resolve() for root in paths.allowed_roots()]
    if not any(_is_relative_to(resolved, root) for root in allowed):
        raise PermissionError("The path is outside Klyraudio's managed folders.")
    return resolved


def _is_relative_to(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def check_upload_name(filename: str, allowed_extensions: Iterable[str]) -> str:
    name = Path(filename or "").name
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise ValueError("Invalid file name.")
    suffix = Path(name).suffix.lower()
    if suffix not in set(allowed_extensions):
        raise ValueError("Unsupported audio file extension.")
    return name


def optional_text(value: str | None, limit: int = 500) -> str:
    return (value or "").strip()[:limit]
