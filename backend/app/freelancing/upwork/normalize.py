"""Upwork's job shapes to this product's snapshot columns.

Two sources describe one posting: the search-result node and the deeper
``marketplaceJobPosting`` aggregate. Both are read defensively - every field
through ``.get`` - because Upwork marks fields nullable over time and a
missing client stat must not cost the whole page.
"""

from __future__ import annotations

from typing import Any

from app.freelancing.snapshot import parse_instant
from app.models.enums import FreelanceJobType

JOB_URL = "https://www.upwork.com/jobs/{ciphertext}"


def money(value: object) -> float | None:
    """A Money object's numeric value, or None when it is absent or zero-as-unset."""
    if not isinstance(value, dict):
        return None
    raw = value.get("rawValue")
    if raw in (None, ""):
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def money_currency(value: object) -> str | None:
    if isinstance(value, dict) and value.get("currency"):
        return str(value["currency"])[:3]
    return None


def _job_type(node: dict) -> FreelanceJobType | None:
    hourly_type = node.get("hourlyBudgetType")
    if money(node.get("hourlyBudgetMin")) is not None or money(node.get("hourlyBudgetMax")) is not None:
        return FreelanceJobType.HOURLY
    if hourly_type in ("DEFAULT", "MANUAL"):
        return FreelanceJobType.HOURLY
    amount = money(node.get("amount"))
    if amount:
        return FreelanceJobType.FIXED
    engagement = str(node.get("engagement") or "").lower()
    if "hr" in engagement or "hour" in engagement:
        return FreelanceJobType.HOURLY
    return None


def _client(node: dict) -> dict[str, Any]:
    client = node.get("client") or {}
    location = client.get("location") or {}
    verification = client.get("verificationStatus")
    total_spent = client.get("totalSpent")
    return {
        "company_name": client.get("companyName") or None,
        "country": location.get("country") or None,
        "city": location.get("city") or None,
        "state": location.get("state") or None,
        "timezone": location.get("timezone") or None,
        "payment_verified": (verification == "VERIFIED") if verification else None,
        "verification_status": verification,
        "total_spent": money(total_spent),
        "total_spent_display": (
            total_spent.get("displayValue") if isinstance(total_spent, dict) else None
        ),
        "total_hires": client.get("totalHires"),
        "total_posted_jobs": client.get("totalPostedJobs"),
        "total_reviews": client.get("totalReviews"),
        "feedback": client.get("totalFeedback"),
        "last_contract_platform": client.get("lastContractPlatform"),
        "has_financial_privacy": client.get("hasFinancialPrivacy"),
    }


def _skills(node: dict) -> list[str]:
    out: list[str] = []
    for skill in node.get("skills") or []:
        if not isinstance(skill, dict):
            continue
        label = skill.get("prettyName") or skill.get("name")
        if label and label not in out:
            out.append(str(label))
    return out


def _labels(node: dict) -> tuple[str | None, str | None]:
    """Category and subcategory, preferring the plain strings Upwork already provides."""
    category = node.get("category")
    subcategory = node.get("subcategory")
    occupations = node.get("occupations") or {}
    if not category and isinstance(occupations.get("category"), dict):
        category = occupations["category"].get("prefLabel")
    if not subcategory:
        subs = occupations.get("subCategories") or []
        if subs and isinstance(subs[0], dict):
            subcategory = subs[0].get("prefLabel")
    return category or None, subcategory or None


def snapshot_from_search_node(node: dict) -> dict[str, Any]:
    """Column values for ``FreelanceJob`` from one search-result node."""
    job_type = _job_type(node)
    amount = node.get("amount")
    category, subcategory = _labels(node)
    ciphertext = node.get("ciphertext")
    return {
        "upwork_id": str(node["id"]),
        "ciphertext": ciphertext,
        "url": JOB_URL.format(ciphertext=ciphertext) if ciphertext else None,
        "title": str(node.get("title") or "Untitled posting"),
        "description": node.get("description"),
        "job_type": job_type,
        "budget_amount": money(amount) if job_type is FreelanceJobType.FIXED else None,
        "budget_currency": money_currency(amount),
        "hourly_min": money(node.get("hourlyBudgetMin")),
        "hourly_max": money(node.get("hourlyBudgetMax")),
        "duration_label": node.get("durationLabel")
        or (node.get("engagementDuration") or {}).get("label")
        or node.get("duration"),
        "workload": node.get("engagement"),
        "experience_level": node.get("experienceLevel"),
        "category": category,
        "subcategory": subcategory,
        "skills": _skills(node),
        "client": _client(node),
        "total_applicants": node.get("totalApplicants"),
        "freelancers_to_hire": node.get("totalFreelancersToHire") or node.get("freelancersToHire"),
        "is_premium": bool(node.get("premium")),
        "is_enterprise": bool(node.get("enterprise")),
        "preferred_freelancer_location": [
            str(v) for v in (node.get("preferredFreelancerLocation") or []) if v
        ],
        "published_at": parse_instant(node.get("publishedDateTime"))
        or parse_instant(node.get("createdDateTime")),
        "renewed_at": parse_instant(node.get("renewedDateTime")),
        "raw": node,
    }


def merge_detail(snapshot: dict[str, Any], detail: dict) -> dict[str, Any]:
    """Fold the ``marketplaceJobPosting`` aggregate into snapshot columns.

    Returns the column updates. The whole aggregate is also kept under
    ``raw["detail"]`` so the proposal engine can read what the columns do not
    carry (screening questions, bid statistics).
    """
    updates: dict[str, Any] = {}
    content = detail.get("content") or {}
    if content.get("title"):
        updates["title"] = str(content["title"])
    if content.get("description"):
        updates["description"] = str(content["description"])

    terms = detail.get("contractTerms") or {}
    contract_type = terms.get("contractType")
    if contract_type == "HOURLY":
        updates["job_type"] = FreelanceJobType.HOURLY
        hourly = terms.get("hourlyContractTerms") or {}
        if hourly.get("hourlyBudgetMin") is not None:
            updates["hourly_min"] = float(hourly["hourlyBudgetMin"])
        if hourly.get("hourlyBudgetMax") is not None:
            updates["hourly_max"] = float(hourly["hourlyBudgetMax"])
        if hourly.get("engagementType"):
            updates["workload"] = str(hourly["engagementType"]).replace("_", " ").title()
        label = (hourly.get("engagementDuration") or {}).get("label")
        if label:
            updates["duration_label"] = label
    elif contract_type == "FIXED":
        updates["job_type"] = FreelanceJobType.FIXED
        fixed = terms.get("fixedPriceContractTerms") or {}
        if money(fixed.get("amount")) is not None:
            updates["budget_amount"] = money(fixed.get("amount"))
            updates["budget_currency"] = money_currency(fixed.get("amount"))
        label = (fixed.get("engagementDuration") or {}).get("label")
        if label:
            updates["duration_label"] = label
    if terms.get("experienceLevel"):
        updates["experience_level"] = terms["experienceLevel"]
    if terms.get("personsToHire"):
        updates["freelancers_to_hire"] = terms["personsToHire"]

    classification = detail.get("classification") or {}
    if not snapshot.get("skills"):
        skills = [
            s.get("prettyName") or s.get("preferredLabel")
            for s in (classification.get("skills") or []) + (classification.get("additionalSkills") or [])
            if isinstance(s, dict)
        ]
        updates["skills"] = [str(s) for s in skills if s]
    if isinstance(classification.get("category"), dict) and classification["category"].get("preferredLabel"):
        updates["category"] = classification["category"]["preferredLabel"]
    if isinstance(classification.get("subCategory"), dict) and classification["subCategory"].get("preferredLabel"):
        updates["subcategory"] = classification["subCategory"]["preferredLabel"]

    company = detail.get("clientCompanyPublic") or {}
    if company:
        client = dict(snapshot.get("client") or {})
        country = company.get("country")
        if isinstance(country, dict) and country.get("name"):
            client["country"] = country["name"]
        for key in ("city", "state", "timezone"):
            if company.get(key):
                client[key] = company[key]
        verification = company.get("paymentVerification") or {}
        if verification.get("paymentVerified") is not None:
            client["payment_verified"] = bool(verification["paymentVerified"])
        updates["client"] = client

    raw = dict(snapshot.get("raw") or {})
    raw["detail"] = detail
    updates["raw"] = raw
    return updates


def upwork_detail_extras(raw: dict) -> dict[str, Any]:
    """The parts of Upwork's fetched aggregate the detail page shows beyond the columns."""
    detail = (raw or {}).get("detail") or {}
    selection = detail.get("contractorSelection") or {}
    requirement = selection.get("proposalRequirement") or {}
    questions = sorted(
        (q for q in (requirement.get("screeningQuestions") or []) if isinstance(q, dict)),
        key=lambda q: q.get("sequenceNumber") or 0,
    )
    activity = detail.get("activityStat") or {}
    bids = activity.get("applicationsBidStats") or {}
    job_activity = activity.get("jobActivity") or {}
    return {
        "screening_questions": [str(q.get("question")) for q in questions if q.get("question")],
        "cover_letter_required": requirement.get("coverLetterRequired"),
        "activity": {
            "last_client_activity": job_activity.get("lastClientActivity"),
            "invites_sent": job_activity.get("invitesSent"),
            "total_invited_to_interview": job_activity.get("totalInvitedToInterview"),
            "total_hired": job_activity.get("totalHired"),
            "total_unanswered_invites": job_activity.get("totalUnansweredInvites"),
            "total_offered": job_activity.get("totalOffered"),
            "average_bid": money(bids.get("avgRateBid")),
            "min_bid": money(bids.get("minRateBid")),
            "max_bid": money(bids.get("maxRateBid")),
            "average_interviewed_bid": money(bids.get("avgInterviewedRateBid")),
        },
        "qualification": selection.get("qualification") or {},
        "location_preference": selection.get("location") or {},
        "attachments": [
            a for a in (detail.get("attachments") or []) if isinstance(a, dict)
        ],
        "on_site_type": (detail.get("contractTerms") or {}).get("onSiteType"),
        "status": (detail.get("workFlowState") or {}).get("status"),
    }
