"""The validation registry must catch every rule it claims to enforce.

A rule that silently never fires is worse than no rule, so each one gets a
negative test alongside the clean-document assertion.
"""

from __future__ import annotations

from app.resume.parser import parse
from app.validation.rules import Context, blocks_autodownload, validate
from tests.conftest import TODAY


def context(md: str, **kw) -> Context:
    return Context(resume=parse(md), today=TODAY, **kw)


def ids(md: str, **kw) -> set[str]:
    return {f.rule_id for f in validate(context(md, **kw))}


def test_reference_resume_is_clean(aran_markdown: str) -> None:
    assert validate(context(aran_markdown, claimed_years=9)) == []


def test_catches_templated_percentage(aran_markdown: str) -> None:
    bad = aran_markdown.replace("from 11 days to 36 hours", "by X%")
    assert "PLACEHOLDER_TOKEN" in ids(bad)


def test_catches_vague_quantifiers(aran_markdown: str) -> None:
    for word in ("several", "various", "multiple", "numerous", "significant"):
        bad = aran_markdown.replace("Mentored 4 engineers", f"Mentored {word} engineers")
        assert "PLACEHOLDER_TOKEN" in ids(bad), word


def test_catches_bracketed_placeholder(aran_markdown: str) -> None:
    bad = aran_markdown.replace("214 customer vaults", "[N] customer vaults")
    assert "PLACEHOLDER_TOKEN" in ids(bad)


def test_catches_wrong_skill_category_count(aran_markdown: str) -> None:
    extra = aran_markdown.replace("- **Frontend**:", "- **Tooling**: Git, Jira\n- **Frontend**:")
    assert "SKILL_CATEGORY_COUNT" in ids(extra)
    fewer = aran_markdown.replace(
        "- **Frontend**: React, TypeScript, Next.js, React Query, Tailwind CSS\n", ""
    )
    assert "SKILL_CATEGORY_COUNT" in ids(fewer)


def test_catches_missing_promotion(aran_markdown: str) -> None:
    collapsed = aran_markdown.replace(
        "#### Senior Software Engineer · Sep 2022 – Oct 2023", "#### KEEP · Sep 2022 – Oct 2023"
    )
    # Remove the older Accenture title block entirely.
    start = collapsed.index("#### Software Engineer · Aug 2020 – Sep 2022")
    end = collapsed.index("### KASIKORN")
    collapsed = collapsed[:start] + collapsed[end:]
    collapsed = collapsed.replace("#### KEEP · Sep 2022 – Oct 2023", "#### Senior Software Engineer · Aug 2020 – Oct 2023")
    assert "PROMOTION_PRESENT" in ids(collapsed)


def test_catches_yoe_mismatch(aran_markdown: str) -> None:
    assert "TENURE_ARITHMETIC" in ids(aran_markdown, claimed_years=15)
    assert "TENURE_ARITHMETIC" not in ids(aran_markdown, claimed_years=9)


def test_catches_employment_gap(aran_markdown: str) -> None:
    gapped = aran_markdown.replace("**Aug 2020 – Oct 2023**", "**Jan 2022 – Oct 2023**").replace(
        "#### Software Engineer · Aug 2020 – Sep 2022",
        "#### Software Engineer · Jan 2022 – Sep 2022",
    )
    assert "EMPLOYMENT_GAP" in ids(gapped)


def test_catches_future_end_date(aran_markdown: str) -> None:
    future = aran_markdown.replace("**Jul 2017 – Jul 2020**", "**Jul 2017 – Jul 2030**").replace(
        "#### Software Engineer · Jul 2017 – Jul 2020",
        "#### Software Engineer · Jul 2017 – Jul 2030",
    )
    assert "DATE_FORMAT" in ids(future)


def test_catches_missing_must_have_keywords(aran_markdown: str) -> None:
    found = ids(aran_markdown, jd_keywords={"must": ["Rust", "GraphQL"]})
    assert "MUST_HAVE_COVERAGE" in found
    assert "MUST_HAVE_COVERAGE" not in ids(
        aran_markdown, jd_keywords={"must": ["FastAPI", "React", "PostgreSQL"]}
    )


def test_mode_b_requires_sourced_dossiers(aran_markdown: str) -> None:
    assert "DOSSIER_PROVENANCE" in ids(aran_markdown, mode="constructed", strict_dossier=True)
    # Grounded mode never demands dossiers - the employers are the user's own.
    assert "DOSSIER_PROVENANCE" not in ids(aran_markdown, mode="grounded", strict_dossier=True)
    ledger = {
        "dossiers": [
            {"employer": e, "sources": ["https://example.com"]}
            for e in ("Veeva Systems", "Accenture", "KASIKORN Business-Technology Group (KBTG)")
        ]
    }
    assert "DOSSIER_PROVENANCE" not in ids(
        aran_markdown, mode="constructed", strict_dossier=True, ledger=ledger
    )


SOURCED = ["https://example.com"]
LEGAL_NAME_LEDGER = {
    "dossiers": [
        {"employer": "Veeva Systems Inc.", "sources": SOURCED},
        {
            "employer": "Accenture (Accenture Solutions Co., Ltd. — part of Accenture plc)",
            "sources": SOURCED,
        },
        {"employer": "KASIKORN Business-Technology Group (KBTG)", "sources": SOURCED},
    ]
}


def test_a_dossier_under_the_legal_name_covers_the_brand(aran_markdown: str) -> None:
    """Regression: the ledger said "Agoda (Agoda Services Co., Ltd. - ...)", the
    resume said "Agoda", and no draft could ever pass."""
    assert "DOSSIER_PROVENANCE" not in ids(
        aran_markdown, mode="constructed", strict_dossier=True, ledger=LEGAL_NAME_LEDGER
    )


def test_an_undossiered_employer_is_pointed_at_the_researched_ones(aran_markdown: str) -> None:
    """The fix used to suggest an archetype description, which fails the same rule."""
    renamed = aran_markdown.replace("### Accenture —", "### Global IT Consultancy —")
    [finding] = [
        f
        for f in validate(
            context(renamed, mode="constructed", strict_dossier=True, ledger=LEGAL_NAME_LEDGER)
        )
        if f.rule_id == "DOSSIER_PROVENANCE"
    ]
    assert "Accenture" in finding.suggested_fix
    assert "Veeva" not in finding.suggested_fix  # already used by another role
    assert "archetype description does not satisfy" in finding.suggested_fix


def test_placeholder_hard_blocks_extension_autodownload(aran_markdown: str) -> None:
    """A defective resume must never reach a real application in one click."""
    bad = aran_markdown.replace("Mentored 4 engineers", "Mentored several engineers")
    assert blocks_autodownload(validate(context(bad))) is True
    assert blocks_autodownload(validate(context(aran_markdown))) is False


def test_gap_warning_does_not_block_autodownload(aran_markdown: str) -> None:
    gapped = aran_markdown.replace("**Aug 2020 – Oct 2023**", "**Jan 2022 – Oct 2023**").replace(
        "#### Software Engineer · Aug 2020 – Sep 2022",
        "#### Software Engineer · Jan 2022 – Sep 2022",
    )
    findings = validate(context(gapped))
    assert any(f.rule_id == "EMPLOYMENT_GAP" for f in findings)
    assert blocks_autodownload(findings) is False
