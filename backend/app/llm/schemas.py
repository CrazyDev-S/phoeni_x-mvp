"""Structured-output schemas for the generation pipeline.

Kept deliberately flat. Anthropic's structured outputs reject recursive
schemas, and silently strip ``minItems``/``minLength``/``pattern`` - so a
schema that looks like it enforces cardinality does not. Real enforcement is
``app/validation/rules.py``; these models only shape the payload.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Dossier(BaseModel):
    """A company may not be named without one of these (prompt §2.3 Step 1)."""

    employer: str
    founded: str = ""
    status: str = ""
    office: str = ""
    headcount_at_hire: str = ""
    sector: str = ""
    ladder: str = ""
    public_title: str = ""
    culture: str = ""
    employment_start: str = ""
    employment_end: str = ""
    work_mode: str = ""
    checks: str = ""
    reason_for_leaving: str = ""
    # Provenance. Empty means model recall only, and the validator says so.
    sources: list[str] = Field(default_factory=list)
    verification: str = "unverified"  # verified_external | asserted_by_user | unverified


class KeywordPlan(BaseModel):
    keyword: str
    priority: str  # MUST | NICE
    planned_sections: list[str] = Field(default_factory=list)


class JobAnalysis(BaseModel):
    """Tailoring's keyword plan, read from the posting itself."""

    required_years: int = 0
    keyword_plan: list[KeywordPlan] = Field(default_factory=list)


class GateCheck(BaseModel):
    id: int
    name: str
    result: str  # PASS | FAIL
    evidence: str = ""


class ScenarioLedger(BaseModel):
    """BLOCK 1. The interview-prep sheet, and the pipeline's working state."""

    mode: str
    base_location: str = ""
    current_location: str = ""
    relocations: str = "none"
    remote_pitch: str = ""

    education: str = ""
    career_start: str = ""
    total_years: int = 0
    job_required_years: int = 0
    size_arc: str = ""
    industry_arc: str = ""
    employer_country_arc: str = ""
    engagement_structure: str = ""

    dossiers: list[Dossier] = Field(default_factory=list)

    gaps: str = "none"
    promotions_shown: str = ""
    world_anchors_used: str = ""
    life_events_used: str = ""
    stack_era_checks: str = ""

    positioning_line: str = ""
    evidence_spine: list[str] = Field(default_factory=list)
    keyword_plan: list[KeywordPlan] = Field(default_factory=list)

    # Self-reported. Stored and displayed as such - the mechanisable subset is
    # independently re-verified in Python.
    gate: list[GateCheck] = Field(default_factory=list)


class EstimatedFigure(BaseModel):
    figure: str
    where: str
    derivation: str
    how_to_reconstruct: str = ""


class UncoveredRequirement(BaseModel):
    requirement: str
    how_to_close: str


class InterviewProbe(BaseModel):
    question: str
    suggested_answer: str


class FlagsReport(BaseModel):
    """BLOCK 4."""

    estimated_figures: list[EstimatedFigure] = Field(default_factory=list)
    uncovered_requirements: list[UncoveredRequirement] = Field(default_factory=list)
    must_verify: list[str] = Field(default_factory=list)
    interview_probes: list[InterviewProbe] = Field(default_factory=list)
    notes: str = ""


class FormFieldAnswer(BaseModel):
    """One answer for the extension's form filler."""

    id: str
    type: str
    answer: str = ""
    checked: bool = False
    needs_user_input: bool = False
    reason: str = ""
