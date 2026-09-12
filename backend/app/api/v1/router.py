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
    tailored_resumes,
    tailoring,
)

api_router = APIRouter(prefix="/api/v1")
for module in (
    auth,
    settings,
    resumes,
    tailored_resumes,
    tailoring,
    generations,
    exports,
    applications,
    meetings,
    maintenance,
    extension,
):
    api_router.include_router(module.router)
