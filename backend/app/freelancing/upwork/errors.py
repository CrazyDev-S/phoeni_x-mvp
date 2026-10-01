"""Errors the Upwork integration raises. All of them are ``JobSourceError``s."""

from __future__ import annotations

from app.freelancing.errors import JobSourceError


class UpworkError(JobSourceError):
    """Anything that stops a call to Upwork from succeeding."""


class UpworkNotConfiguredError(UpworkError):
    """No API key pair, in Settings or the environment."""

    def __init__(self) -> None:
        super().__init__(
            "UPWORK_NOT_CONFIGURED",
            "Add your Upwork API key pair under Settings -> Integrations first.",
            status=409,
        )


class UpworkNotConnectedError(UpworkError):
    """A key pair exists but the user has not authorized the app, or the link lapsed."""

    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            "UPWORK_NOT_CONNECTED",
            message or "Connect your Upwork account under Settings -> Integrations.",
            status=409,
        )


class UpworkAuthError(UpworkError):
    """Upwork rejected the token. The caller should refresh, or ask the user to reconnect.

    409, not 401: to the portal a 401 means its own session expired.
    """

    def __init__(self, message: str = "Upwork rejected the access token") -> None:
        super().__init__("UPWORK_UNAUTHORIZED", message, status=409)


class UpworkScopeError(UpworkError):
    """The API key was created without the permission this call needs."""

    def __init__(self, message: str) -> None:
        super().__init__("UPWORK_MISSING_SCOPE", message, status=403)


class UpworkRateLimitedError(UpworkError):
    def __init__(self, retry_after_seconds: int | None) -> None:
        super().__init__(
            "UPWORK_RATE_LIMITED",
            "Upwork is rate-limiting this address (300 requests a minute). Try again shortly.",
            status=429,
            retryable=True,
            retry_after_seconds=retry_after_seconds,
        )
