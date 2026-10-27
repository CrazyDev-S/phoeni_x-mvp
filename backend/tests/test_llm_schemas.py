"""The structured-output schemas, and how they reach each provider.

They are hand-written JSON Schema sent as they are, so these tests hold them
to what both providers' strict modes accept, and check nothing rewrites them
on the way out.
"""

from __future__ import annotations

import json

import pytest

from app.llm import schemas
from app.llm.anthropic_adapter import AnthropicAdapter
from app.llm.openai_adapter import OpenAIAdapter
from app.llm.provider import LLMRequest, SystemBlock

SCHEMAS = {
    name: value
    for name, value in vars(schemas).items()
    if name.isupper() and isinstance(value, dict) and value.get("type") == "object"
}

# Keywords the providers drop or reject; a schema carrying one would imply an
# enforcement that never happens.
UNSUPPORTED = {
    "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum",
    "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "pattern", "format",
    "default", "examples", "$ref", "$defs", "title",
}


def nodes(schema: dict):
    """Every schema node in the tree, the root first."""
    yield schema
    if schema["type"] == "object":
        for prop in schema["properties"].values():
            yield from nodes(prop)
    elif schema["type"] == "array":
        yield from nodes(schema["items"])


@pytest.mark.parametrize("name", sorted(SCHEMAS))
def test_every_schema_is_strict_mode_valid(name: str) -> None:
    schema = SCHEMAS[name]
    json.dumps(schema)  # plain data, nothing else
    for node in nodes(schema):
        assert not UNSUPPORTED & node.keys(), f"{name}: {UNSUPPORTED & node.keys()}"
        if node["type"] == "object":
            assert node["additionalProperties"] is False
            assert node["required"] == list(node["properties"])


def test_the_staged_schemas_describe_every_field() -> None:
    """The model reads these; a bare field name leaves it guessing."""
    for name in ("JOB_CRITERIA", "COMPANY_RESEARCH", "EDUCATION_RECORD", "FLAGS_REPORT"):
        for node in nodes(SCHEMAS[name]):
            for key, prop in node.get("properties", {}).items():
                assert prop.get("description"), f"{name}.{key} has no description"


def request(schema: dict) -> LLMRequest:
    return LLMRequest(
        purpose="scenario",
        system=[SystemBlock("x")],
        messages=[{"role": "user", "content": "go"}],
        output_schema=schema,
    )


def test_anthropic_receives_the_schema_as_written() -> None:
    kwargs = AnthropicAdapter("sk-test", "claude-opus-5")._kwargs(request(schemas.SCENARIO_LEDGER))
    assert kwargs["output_config"]["format"] == {
        "type": "json_schema",
        "schema": schemas.SCENARIO_LEDGER,
    }


def test_openai_receives_the_schema_as_written() -> None:
    kwargs = OpenAIAdapter("sk-test", "gpt-6.1-sol")._kwargs(request(schemas.SCENARIO_LEDGER))
    assert kwargs["text"]["format"] == {
        "type": "json_schema",
        "name": "scenario",
        "strict": True,
        "schema": schemas.SCENARIO_LEDGER,
    }


def test_shape_fills_what_a_reply_left_out() -> None:
    ledger = schemas.shape(
        schemas.SCENARIO_LEDGER,
        {
            "mode": "grounded",
            "total_years": "9",
            "job_required_years": None,
            "dossiers": [{"employer": "Acme"}, "not an object"],
            "keyword_plan": [{"keyword": "React", "priority": "MUST"}],
            "unexpected": "dropped",
        },
    )

    assert ledger["total_years"] == 9
    assert ledger["job_required_years"] == 0
    assert ledger["gate"] == [] and ledger["input_problem"] == ""
    assert ledger["dossiers"][0]["employer"] == "Acme"
    assert ledger["dossiers"][0]["sources"] == []
    assert ledger["dossiers"][1]["employer"] == ""
    assert ledger["keyword_plan"][0]["planned_sections"] == []
    assert "unexpected" not in ledger
    assert set(ledger) == set(schemas.SCENARIO_LEDGER["properties"])
