"""A form is answered from the resume first, and only then by a model."""

from __future__ import annotations

import json

from app.llm.provider import MissingCredentialError
from app.remote.orchestration.form_pipeline import FormContext, answer_form, fact_for, is_sensitive
from app.remote.orchestration.resume_facts import build_facts, flat_facts
from app.remote.resume.parser import parse
from app.remote.services.job_links import job_key
from app.schemas.extension import AutofillRequest, FormFieldIn
from tests.test_pipeline import StubProvider


def form(*fields: dict) -> AutofillRequest:
    return AutofillRequest(
        frames=[
            {
                "frame_key": "f0",
                "fields": [{"id": f"f0:{i}", **field} for i, field in enumerate(fields)],
            }
        ]
    )


def context(markdown: str, profile: dict[str, str] | None = None) -> FormContext:
    facts, from_profile = build_facts(parse(markdown), profile)
    return FormContext(
        resume_text="(resume)",
        resume_name="Acme — Senior AI Engineer",
        facts=flat_facts(facts),
        profile_facts=frozenset(from_profile),
        autofill_fields=profile or {},
    )


def model(provider):
    async def get():
        return provider

    return get


def reply(**answers: str) -> str:
    return json.dumps(
        {key: {"answer": value, "needs_user_input": False, "reason": ""} for key, value in answers.items()}
    )


# The Ashby form from the bug report, where every one of these came back
# "not present in your profile", plus the questions around them.
ASHBY = form(
    {"type": "file", "label": "Resume"},
    {"type": "text", "label": "Full Legal Name", "required": True},
    {"type": "email", "label": "Email"},
    {"type": "tel", "label": "Phone"},
    {"type": "url", "label": "LinkedIn Profile"},
    {"type": "text", "label": "Location"},
    {
        "type": "radio",
        "label": "Are you authorized to work in the United States?",
        "options": [{"label": "Yes"}, {"label": "No"}],
    },
    {"type": "textarea", "label": "Why do you want to join our corporate team?"},
    {"type": "file", "label": "Cover Letter"},
)


async def test_contact_details_are_read_off_the_resume(aran_markdown) -> None:
    stub = StubProvider(["```json\n" + reply(f0_7="To build document AI.") + "\n```"])
    result = await answer_form(model(stub), ASHBY, context=context(aran_markdown))

    answers = {a.id: a for a in result.answers}
    assert answers["f0:1"].answer == "Aran Thammasiri"
    assert answers["f0:2"].answer == "aran.thammasiri@outlook.com"
    assert answers["f0:3"].answer == "+1 727 732 3633"
    assert answers["f0:4"].answer == "https://linkedin.com/in/aran-thammasiri-989506433"
    assert answers["f0:5"].answer == "Bangkok, Thailand"
    assert answers["f0:1"].source == "resume"
    assert (answers["f0:0"].type, answers["f0:0"].answer) == ("file", "resume")
    # A fenced reply is still read, and "corporate" is not a question about pay.
    assert answers["f0:7"].answer == "To build document AI."
    assert {u.id for u in result.unanswered} == {"f0:6", "f0:8"}
    assert result.complete
    # Filled in page order, top to bottom.
    assert list(answers) == ["f0:0", "f0:1", "f0:2", "f0:3", "f0:4", "f0:5", "f0:7"]

    # The model is asked only what the resume could not answer, and without
    # thinking spending the output budget.
    (request,) = stub.requests
    prompt = request.messages[0]["content"]
    assert "f0_7" in prompt
    assert "f0_1" not in prompt
    assert request.thinking is False


async def test_the_autofill_profile_wins_over_the_resume(aran_markdown) -> None:
    stub = StubProvider([])
    profile = {"Full name": "Aran T. Smith", "Phone": "+66 81 234 5678"}
    result = await answer_form(
        model(stub),
        form(
            {"type": "text", "label": "First name"},
            {"type": "text", "label": "Last name"},
            {"type": "tel", "label": "Mobile"},
            {"type": "select", "label": "Country", "options": [{"label": "Japan"}, {"label": "Thailand"}]},
        ),
        context=context(aran_markdown, profile),
    )

    assert [(a.answer, a.source) for a in result.answers] == [
        ("Aran", "profile"),
        ("Smith", "profile"),
        ("+66 81 234 5678", "profile"),
        ("Thailand", "resume"),
    ]
    assert stub.requests == []


async def test_an_unreadable_reply_is_not_blamed_on_the_profile(aran_markdown) -> None:
    stub = StubProvider(["Sure - here are the answers you asked for."])
    result = await answer_form(
        model(stub),
        form({"type": "email", "label": "Email"}, {"type": "textarea", "label": "Tell us about a project"}),
        context=context(aran_markdown),
    )

    assert [a.id for a in result.answers] == ["f0:0"]
    (gap,) = result.unanswered
    assert "unreadable" in gap.reason
    assert not result.complete


async def test_contact_details_fill_with_no_model_key(aran_markdown) -> None:
    async def no_key():
        raise MissingCredentialError("anthropic")

    result = await answer_form(
        no_key,
        form({"type": "text", "label": "Name"}, {"type": "textarea", "label": "Cover letter"}),
        context=context(aran_markdown),
    )

    assert result.answers[0].answer == "Aran Thammasiri"
    assert result.unanswered[0].reason == "No API key configured for anthropic"
    assert not result.complete


async def test_only_a_resume_upload_is_sent_the_resume(aran_markdown) -> None:
    result = await answer_form(
        model(StubProvider([])),
        form(
            {"type": "file", "label": "Resume/CV", "accept": ".pdf"},
            {"type": "file", "label": "Autofill from resume"},
            {"type": "file", "label": "", "name": "_systemfield_resume", "accept": ".pdf,.docx"},
        ),
        context=context(aran_markdown),
    )

    assert [a.id for a in result.answers] == ["f0:2"]
    reasons = {u.id: u.reason for u in result.unanswered}
    assert ".pdf" in reasons["f0:0"]
    assert reasons["f0:1"] == "Attach this file yourself"

    nothing_linked = await answer_form(
        model(StubProvider([])), form({"type": "file", "label": "Resume"}), context=FormContext()
    )
    assert nothing_linked.unanswered[0].reason.startswith("Link or tailor a resume")


YES_NO = [{"label": "Yes"}, {"label": "No"}]

# The Lever form from the bug report, with the user's stored answers spelled
# as they typed them.
LEVER_SENSITIVE = form(
    {"type": "radio", "label": "Are you currently authorized to work in the US for any employer?",
     "options": YES_NO},
    {"type": "radio", "label": "Do you now or will you in the future require employer sponsorship?",
     "options": YES_NO},
    {"type": "radio", "label": "Does your work authorization now, or will it in the future, involve CPT or OPT?",
     "options": YES_NO},
    {"type": "select", "label": "Gender",
     "options": [{"label": "Select ..."}, {"label": "Male"}, {"label": "Female"}]},
    {"type": "select", "label": "Race",
     "options": [{"label": "Select ..."}, {"label": "Asian (Not Hispanic or Latino)"},
                 {"label": "White (Not Hispanic or Latino)"}]},
    {"type": "select", "label": "Veteran status",
     "options": [{"label": "I am a veteran"}, {"label": "I am not a veteran"}]},
)


async def test_sensitive_questions_take_only_the_users_stored_answers(aran_markdown) -> None:
    profile = {"US authorization": "Yes", "Sponsership": "No", "Gender": "Male", "Race": "Asian"}
    stub = StubProvider([json.dumps({
        "f0_0": {"answer": "Yes", "stored_key": "us authorization"},
        "f0_1": {"answer": "Yes", "stored_key": "Sponsership"},
        "f0_2": {"answer": "No", "needs_user_input": True, "reason": "No stored answer on CPT or OPT"},
        "f0_3": {"answer": "Female", "stored_key": "Gender"},
        "f0_4": {"answer": "Asian (Not Hispanic or Latino)", "stored_key": "Race"},
        "f0_5": {"answer": "I am not a veteran", "stored_key": "Veteran status"},
    })])
    result = await answer_form(model(stub), LEVER_SENSITIVE, context=context(aran_markdown, profile))

    answers = {a.id: a for a in result.answers}
    assert answers["f0:0"].answer == "Yes"
    # The stored answer stands, whatever the model says.
    assert answers["f0:1"].answer == "No"
    assert answers["f0:3"].answer == "Male"
    # Stored in the user's own words: the model's pick of option, flagged.
    assert (answers["f0:4"].answer, answers["f0:4"].matched_fuzzily) == (
        "Asian (Not Hispanic or Latino)", True,
    )
    assert not answers["f0:0"].matched_fuzzily
    assert {a.source for a in answers.values()} == {"profile"}
    # No stored answer on CPT or OPT, and none called "Veteran status".
    assert {u.id for u in result.unanswered} == {"f0:2", "f0:5"}
    (request,) = stub.requests
    assert "sensitive" in request.messages[0]["content"]


async def test_with_nothing_stored_a_sensitive_question_is_never_sent(aran_markdown) -> None:
    stub = StubProvider([])
    result = await answer_form(model(stub), LEVER_SENSITIVE, context=context(aran_markdown))

    assert stub.requests == []
    assert result.answers == []
    assert all("autofill profile" in u.reason for u in result.unanswered)


def test_sensitive_questions_are_matched_as_words() -> None:
    def asks(label: str) -> bool:
        return is_sensitive(FormFieldIn(id="x", label=label))

    assert asks("Will you now or in the future require visa sponsorship?")
    assert asks("What are your salary expectations?")
    assert asks("Gender")
    assert not asks("Why our corporate mission?")
    assert not asks("I confirm this information is accurate")
    assert not asks("Is it advisable to work from our Essex office?")


def test_only_the_candidates_own_details_are_matched() -> None:
    def fact(label: str, field_type: str = "text") -> str | None:
        return fact_for(FormFieldIn(id="x", label=label, type=field_type))

    assert fact("Preferred first name") == "first_name"
    assert fact("LinkedIn Profile URL") == "linkedin"
    assert fact("Where are you currently based?") == "location"
    assert fact("Referrer email", "email") is None
    assert fact("How many years of experience do you have with Kafka?") is None
    assert fact("Preferred location") is None


def test_a_posting_and_its_application_form_share_a_key() -> None:
    assert (
        job_key("https://jobs.ashbyhq.com/deepgram/0f1c2d?utm_source=linkedin")
        == job_key("https://jobs.ashbyhq.com/deepgram/0f1c2d/application")
        == "jobs.ashbyhq.com/deepgram/0f1c2d"
    )
    assert job_key("https://jobs.lever.co/acme/abc/apply") == "jobs.lever.co/acme/abc"
    assert job_key("https://www.boards.greenhouse.io/acme/jobs/123#app") == "boards.greenhouse.io/acme/jobs/123"
    # A board that names the job in the query keeps it.
    assert job_key("https://acme.com/careers?gh_jid=1&gh_src=x") == "acme.com/careers?gh_jid=1"
    # A job id after /apply is not an application suffix.
    assert job_key("https://example.com/apply/123") == "example.com/apply/123"
