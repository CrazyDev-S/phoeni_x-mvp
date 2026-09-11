"""Envelope encryption for per-user LLM API keys.

AES-256-GCM with a fresh 96-bit nonce per row. The AAD binds the ciphertext
to its owner, so a row copied into another user's record fails to decrypt
rather than silently working.

Deliberately not pgcrypto's ``pgp_sym_encrypt``: that puts key material into
SQL text, ``pg_stat_statements`` and the WAL.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

NONCE_BYTES = 12
CURRENT_KEK_VERSION = 1


@dataclass(frozen=True, slots=True)
class SealedSecret:
    ciphertext: bytes
    nonce: bytes
    kek_version: int
    last4: str
    fingerprint: bytes


def _aad(user_id: str, provider: str, label: str) -> bytes:
    return f"{user_id}|{provider}|{label}".encode()


def _kek() -> bytes:
    return get_settings().kek_bytes


def seal(plaintext: str, *, user_id: str, provider: str, label: str) -> SealedSecret:
    nonce = secrets.token_bytes(NONCE_BYTES)
    ct = AESGCM(_kek()).encrypt(nonce, plaintext.encode(), _aad(user_id, provider, label))
    return SealedSecret(
        ciphertext=ct,
        nonce=nonce,
        kek_version=CURRENT_KEK_VERSION,
        last4=plaintext[-4:] if len(plaintext) >= 4 else "",
        fingerprint=fingerprint(plaintext),
    )


def unseal(
    sealed_ct: bytes,
    nonce: bytes,
    *,
    user_id: str,
    provider: str,
    label: str,
) -> str:
    raw = AESGCM(_kek()).decrypt(nonce, sealed_ct, _aad(user_id, provider, label))
    return raw.decode()


def fingerprint(plaintext: str) -> bytes:
    """Stable, non-reversible id for a key, so duplicates are detectable."""
    return hmac.new(_kek(), plaintext.encode(), hashlib.sha256).digest()


def mask(last4: str, provider: str) -> str:
    prefix = {"anthropic": "sk-ant-", "openai": "sk-"}.get(provider, "sk-")
    return f"{prefix}...{last4}" if last4 else "not configured"
