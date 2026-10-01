"""Aggregate router for API v1.

The URL space mirrors the product's shape:

    /api/v1/auth, /settings, /generations   account and platform
    /api/v1/remote/...                       the Remote category (resumes, tailoring,
                                             applications, the browser extension)
    /api/v1/freelancing/...                  the Freelancing category (job search
                                             through Apify or Upwork, focus,
                                             proposals, tracking)
    /api/v1/shared/...                       tools both categories use (calendar,
                                             job maintenance, interview assist)

Each category is its own package under ``app/api/v1``; a new endpoint goes in
the package of the category it belongs to, and the prefix is added here once.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth, generations, settings
from app.api.v1.freelancing import apify, jobs, profile, proposals, source, tracking, upwork
from app.api.v1.remote import (
    applications,
    exports,
    extension,
    resumes,
    tailored_resumes,
    tailoring,
)
from app.api.v1.shared import interview, maintenance, meetings

api_router = APIRouter(prefix="/api/v1")

for module in (auth, settings, generations):
    api_router.include_router(module.router)

remote_router = APIRouter(prefix="/remote")
for module in (resumes, tailored_resumes, tailoring, exports, applications, extension):
    remote_router.include_router(module.router)

freelancing_router = APIRouter(prefix="/freelancing")
for module in (source, apify, upwork, jobs, profile, proposals, tracking):
    freelancing_router.include_router(module.router)

shared_router = APIRouter(prefix="/shared")
for module in (meetings, maintenance, interview):
    shared_router.include_router(module.router)

for category in (remote_router, freelancing_router, shared_router):
    api_router.include_router(category)
