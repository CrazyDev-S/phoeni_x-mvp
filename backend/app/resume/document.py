"""The resume render model.

Markdown is the canonical stored form; this AST is a transient representation
produced by the parser and consumed by the docx/plain-text renderers and the
validation rules.

Every field is strict on purpose: ``extra="forbid"`` means a drifting parser
or a hand-edit that invents a field fails loudly here rather than silently
producing a wrong document.
"""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]
MONTH_INDEX = {m: i + 1 for i, m in enumerate(MONTHS)}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Txt = Annotated[str, Field(min_length=1, max_length=400)]
Short = Annotated[str, Field(min_length=1, max_length=80)]


class YearMonth(Strict):
    year: Annotated[int, Field(ge=1950, le=2100)]
    month: Annotated[int, Field(ge=1, le=12)] | None = None

    def __str__(self) -> str:
        return f"{MONTHS[self.month - 1]} {self.year}" if self.month else str(self.year)

    @property
    def ordinal(self) -> int:
        """Months since year 0, for arithmetic and ordering."""
        return self.year * 12 + (self.month or 1)


class DateRange(Strict):
    start: YearMonth
    end: YearMonth | None = None
    is_current: bool = False

    @model_validator(mode="after")
    def _coherent(self) -> Self:
        if self.is_current and self.end is not None:
            raise ValueError("a current range must not have an end date")
        if not self.is_current and self.end is None:
            raise ValueError("a range needs an end date unless it is current")
        if self.end is not None and self.end.ordinal < self.start.ordinal:
            raise ValueError(f"range ends ({self.end}) before it starts ({self.start})")
        return self

    def __str__(self) -> str:
        return f"{self.start} – {'Present' if self.is_current else self.end}"

    def months(self, today_ordinal: int | None = None) -> int:
        end = (
            today_ordinal
            if self.is_current and today_ordinal is not None
            else (self.end.ordinal if self.end else self.start.ordinal)
        )
        return max(0, end - self.start.ordinal)


class ContactLink(Strict):
    label: Txt
    url: str | None = None


class Header(Strict):
    name: Txt
    title: Txt
    location: Txt
    work_preference: Short | None = None
    timezone_note: Txt | None = None
    phone: Short | None = None
    email: Short | None = None
    links: Annotated[list[ContactLink], Field(max_length=4)] = Field(default_factory=list)
    availability: Txt | None = None


class SkillCategory(Strict):
    label: Annotated[str, Field(min_length=1, max_length=60)]
    items: Annotated[list[Short], Field(min_length=1, max_length=14)]

    @property
    def value(self) -> str:
        return ", ".join(self.items)


class TitleBlock(Strict):
    title: Txt
    dates: DateRange
    promotion_note: Txt | None = None
    bullets: Annotated[list[Txt], Field(min_length=1, max_length=10)]


class Experience(Strict):
    company: Txt
    city: Short | None = None
    country: Short | None = None
    work_mode: Short | None = None
    total_tenure: DateRange
    context: Annotated[str, Field(max_length=400)] | None = None
    titles: Annotated[list[TitleBlock], Field(min_length=1, max_length=2)]

    @property
    def layout(self) -> Literal["single", "promotion"]:
        return "single" if len(self.titles) == 1 else "promotion"

    @property
    def location_label(self) -> str:
        parts = [p for p in (self.city, self.country) if p]
        return ", ".join(parts)

    @model_validator(mode="after")
    def _titles_newest_first(self) -> Self:
        if len(self.titles) == 2:
            a, b = self.titles
            if a.dates.start.ordinal < b.dates.start.ordinal:
                raise ValueError(
                    f"{self.company}: title blocks must be newest first"
                )
            if b.dates.is_current:
                raise ValueError(
                    f"{self.company}: only the newest title block may be current"
                )
        return self


class Project(Strict):
    name: Txt
    context: Txt | None = None
    bullets: Annotated[list[Txt], Field(max_length=4)] = Field(default_factory=list)


class Education(Strict):
    degree: Txt
    institution: Txt
    city: Short | None = None
    country: Short | None = None
    year: Annotated[int, Field(ge=1950, le=2100)] | None = None


class Certification(Strict):
    name: Txt
    issuer: Short | None = None
    year: Annotated[int, Field(ge=1950, le=2100)] | None = None


class Language(Strict):
    name: Short
    proficiency: Short


class Resume(Strict):
    markdown_version: int = 1
    header: Header
    summary: Annotated[str, Field(min_length=1, max_length=1400)]
    skills: Annotated[list[SkillCategory], Field(max_length=8)]
    experience: Annotated[list[Experience], Field(max_length=8)]
    projects: Annotated[list[Project], Field(max_length=4)] = Field(default_factory=list)
    education: Annotated[list[Education], Field(max_length=4)] = Field(
        default_factory=list
    )
    certifications: Annotated[list[Certification], Field(max_length=8)] = Field(
        default_factory=list
    )
    languages: Annotated[list[Language], Field(max_length=6)] = Field(
        default_factory=list
    )

    # NOTE: the generator prompt's hard rules (exactly 4 skill categories, at
    # most 3 companies, at least one promotion) are deliberately NOT enforced
    # here. This model must be able to represent a non-compliant resume so the
    # validation layer can report precisely what is wrong; rejecting at parse
    # time would turn every rule violation into an opaque parse error.
