"""The one error shape every job source raises.

``code`` is stable and machine-readable; ``message`` is for the person
reading the screen; ``status`` is the HTTP status the API answers with,
chosen here so every router and every source agree. The Upwork client's
errors subclass this; a third-party API's adapter raises it directly.
"""

from __future__ import annotations


class JobSourceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 502,
        retryable: bool = False,
        retry_after_seconds: int | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"{code}: {message}")


class JobSourceNotConfiguredError(JobSourceError):
    """The source in service needs a credential that is not set."""

    def __init__(self, message: str) -> None:
        super().__init__("JOB_SOURCE_NOT_CONFIGURED", message, status=409)


class JobSourceRateLimitedError(JobSourceError):
    def __init__(self, source: str, retry_after_seconds: int | None) -> None:
        super().__init__(
            "JOB_SOURCE_RATE_LIMITED",
            f"{source} is rate-limiting requests. Try again shortly.",
            status=429,
            retryable=True,
            retry_after_seconds=retry_after_seconds,
        )
