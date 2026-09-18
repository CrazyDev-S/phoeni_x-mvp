"""Plain facts about the candidate, read off one resume.

Two consumers. The side panel shows them beside an application form, so
nothing has to be copied back out of a downloaded .docx. And the form filler
answers contact fields with them directly: putting an email address in an
Email field is not a question for a model.
"""

from __future__ import annotations

from app.core.timezone import app_today
from app.resume.document import Education, Experience, Resume
from app.schemas.extension import FactPair, ResumeFacts
from app.services.resumes import claimed_years

# Autofill profile rows that state one of the facts, by their normalised
# question. The profile wins over the resume: it is what the user typed for
# exactly this purpose.
PROFILE_ALIASES: dict[str, tuple[str, ...]] = {
    "full_name": ("full name", "name", "legal name", "full legal name"),
    "first_name": ("first name", "given name", "preferred name"),
    "last_name": ("last name", "family name", "surname"),
    "email": ("email", "email address"),
    "phone": ("phone", "phone number", "mobile", "mobile number"),
    "linkedin": ("linkedin", "linkedin url", "linkedin profile"),
    "github": ("github", "github url", "github profile"),
    "website": ("portfolio", "portfolio url", "website", "personal website"),
    "location": ("location", "current location"),
    "city": ("city",),
    "country": ("country", "country of residence"),
}
LINK_FACTS = {"linkedin", "github", "website"}


def build_facts(
    resume: Resume | None, profile: dict[str, str] | None = None
) -> tuple[ResumeFacts, set[str]]:
    """The resume's facts with the autofill profile's answers on top.

    Returns the facts, and the names of the ones the profile supplied.
    """
    facts = ResumeFacts()
    values: dict[str, str | None] = {}

    if resume is not None:
        header = resume.header
        values.update(
            full_name=header.name,
            email=header.email,
            phone=header.phone,
            location=header.location,
            headline=header.title,
            work_preference=header.work_preference,
            availability=header.availability,
        )
        for link in header.links:
            url = _as_url(link.url or link.label)
            if url:
                values.setdefault(_link_kind(url), url)
        role = _current_role(resume)
        if role is not None:
            values["current_company"] = role.company
            values["current_title"] = role.titles[0].title
        facts.years_experience = _years(resume)
        facts.summary = resume.summary
        facts.skills = [FactPair(label=c.label, value=c.value) for c in resume.skills]
        facts.education = [_education(e) for e in resume.education]
        facts.languages = [f"{lang.name} — {lang.proficiency}" for lang in resume.languages]

    answers = {
        " ".join(key.lower().replace("_", " ").split()): value.strip()
        for key, value in (profile or {}).items()
        if isinstance(value, str) and value.strip()
    }
    from_profile: set[str] = set()
    for fact, aliases in PROFILE_ALIASES.items():
        answer = next((answers[alias] for alias in aliases if alias in answers), None)
        if answer:
            values[fact] = (_as_url(answer) or answer) if fact in LINK_FACTS else answer
            from_profile.add(fact)

    # Derived after the profile is applied, so a name typed there splits too.
    if name := values.get("full_name"):
        words = name.split()
        if not values.get("first_name"):
            values["first_name"] = words[0]
            if "full_name" in from_profile:
                from_profile.add("first_name")
        if not values.get("last_name") and len(words) > 1:
            values["last_name"] = words[-1]
            if "full_name" in from_profile:
                from_profile.add("last_name")
    if location := values.get("location"):
        pieces = [p.strip() for p in location.split(",") if p.strip()]
        if not values.get("city") and pieces:
            values["city"] = pieces[0]
        if not values.get("country") and len(pieces) > 1:
            values["country"] = pieces[-1]

    for key, value in values.items():
        setattr(facts, key, value)
    return facts, from_profile


def flat_facts(facts: ResumeFacts) -> dict[str, str]:
    """The single-value facts as strings, for matching against form fields."""
    flat = {k: v for k, v in facts.model_dump().items() if isinstance(v, str) and v}
    if facts.years_experience:
        flat["years_experience"] = str(facts.years_experience)
    return flat


def _as_url(text: str) -> str | None:
    """A link as a URL a form will accept, or None when the text is not a link."""
    text = text.strip()
    if not text or " " in text or "." not in text:
        return None
    return text if "://" in text else f"https://{text}"


def _link_kind(url: str) -> str:
    lowered = url.lower()
    if "linkedin." in lowered:
        return "linkedin"
    if "github." in lowered:
        return "github"
    return "website"


def _current_role(resume: Resume) -> Experience | None:
    if not resume.experience:
        return None
    return max(
        resume.experience,
        key=lambda e: (e.total_tenure.is_current, e.total_tenure.start.ordinal),
    )


def _years(resume: Resume) -> int | None:
    """The years the summary claims, or else the span the roles cover."""
    if (claimed := claimed_years(resume)) is not None:
        return claimed
    if not resume.experience:
        return None
    today = app_today()
    now = today.year * 12 + today.month
    start = min(e.total_tenure.start.ordinal for e in resume.experience)
    end = max(
        now if e.total_tenure.is_current or e.total_tenure.end is None
        else e.total_tenure.end.ordinal
        for e in resume.experience
    )
    return (end - start) // 12 or None


def _education(entry: Education) -> str:
    return ", ".join(
        part for part in (entry.degree, entry.institution, str(entry.year) if entry.year else "")
        if part
    )
