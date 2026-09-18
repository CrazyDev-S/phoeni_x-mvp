"""UUIDv7 generation.

Time-ordered ids keep btree locality on the insert-heavy tables
(``llm_calls``, ``generation_events``, ``meetings``). Random v4 keys scatter
writes across the whole index and progressively destroy insert performance.

``uuid.uuid7`` only lands in CPython 3.14; this is the RFC 9562 layout
implemented for 3.12.
"""

from __future__ import annotations

import os
import time
import uuid

_last_ms = 0
_counter = 0


def uuid7() -> uuid.UUID:
    """RFC 9562 v7: 48-bit ms timestamp, 12-bit counter, 62 bits of entropy."""
    global _last_ms, _counter

    ms = int(time.time() * 1000)
    if ms == _last_ms:
        _counter = (_counter + 1) & 0x0FFF
        if _counter == 0:  # counter rollover within the same millisecond
            ms = _last_ms + 1
    else:
        _counter = int.from_bytes(os.urandom(2), "big") & 0x0FFF
    _last_ms = ms

    rand_b = int.from_bytes(os.urandom(8), "big") & ((1 << 62) - 1)

    value = (ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76  # version
    value |= _counter << 64
    value |= 0b10 << 62  # variant
    value |= rand_b
    return uuid.UUID(int=value)
