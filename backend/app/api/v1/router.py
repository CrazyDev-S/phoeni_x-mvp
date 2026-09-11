"""Aggregate router for API v1."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    applications,
    auth,
    exports,
    extension,
    generations,
    maintenance,
    meetings,
    resumes,
    settings,
    tailoring,
)

api_router = APIRouter(prefix="/api/v1")
for module in (
    auth,
    settings,
    resumes,
    tailoring,
    generations,
    exports,
    applications,
    meetings,
    maintenance,
    extension,
):
    api_router.include_router(module.router)
