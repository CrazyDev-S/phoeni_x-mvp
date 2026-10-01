"""One seam for tests to swap the network out, for every job source.

Production code passes nothing and gets httpx's default transport. A test
installs a ``httpx.MockTransport`` here and every outbound call in the category (Upwork, Apify),
OAuth included, goes through it.
"""

from __future__ import annotations

import httpx

_override: httpx.AsyncBaseTransport | None = None


def set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    global _override
    _override = transport


def current_transport() -> httpx.AsyncBaseTransport | None:
    return _override
