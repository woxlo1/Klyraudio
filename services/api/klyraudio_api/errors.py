"""Explicit error model shared by the API and internal services."""

from __future__ import annotations

from typing import Any, Dict, Optional


class ApiError(Exception):
    """An error that is safe to expose to the local UI."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: Optional[Dict[str, Any]] = None,
        remediation: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        self.remediation = remediation

    def to_payload(self, request_id: str) -> Dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
                "remediation": self.remediation,
                "request_id": request_id,
            }
        }


class NotFound(ApiError):
    def __init__(self, resource: str, identifier: str) -> None:
        super().__init__(
            "not_found",
            f"{resource} was not found.",
            status_code=404,
            details={"resource": resource, "id": identifier},
        )


class ValidationFailed(ApiError):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__("validation_failed", message, status_code=422, details=details)


class PermissionDenied(ApiError):
    def __init__(self, message: str) -> None:
        super().__init__("permission_denied", message, status_code=403)


class DependencyMissing(ApiError):
    def __init__(self, dependency: str, remediation: str) -> None:
        super().__init__(
            "dependency_missing",
            f"{dependency} is required but is not available.",
            status_code=409,
            details={"dependency": dependency},
            remediation=remediation,
        )


class ResourceBusy(ApiError):
    def __init__(self, message: str) -> None:
        super().__init__("resource_busy", message, status_code=409)


class OutOfMemory(ApiError):
    def __init__(self, backend: str, message: str) -> None:
        super().__init__(
            "out_of_memory",
            message,
            status_code=507,
            details={"backend": backend},
            remediation=(
                "Close other GPU applications, choose a smaller model, enable a low-memory "
                "mode if the model supports it, or switch inference to CPU in Settings."
            ),
        )
