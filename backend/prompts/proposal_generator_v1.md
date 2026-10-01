<!-- PLACEHOLDER: proposal prompt not supplied yet -->

# Proposal Generator (v1) — placeholder

This file is where the Freelancing proposal prompt goes. It is loaded verbatim
by `app/freelancing/proposals/engine.py` and treated as a byte-frozen system
prefix, exactly like `resume_generator_v1.md` is for the Remote category:
nothing is interpolated into it, so it can be a cached prefix.

Until the prompt is supplied, `get_engine()` returns the template engine, and
every draft it writes is labelled `template-v0`.

Inputs the engine will hand the prompt, in the first user turn:

- the posting: title, description, contract terms, skills, client facts,
  screening questions
- the freelancer profile: title, overview, rate, skills, portfolio, and the
  free-form profile markdown
- the user's instructions for this draft, and the requested tone

Expected output: a JSON object with `cover_letter_markdown`, `answers`
(`[{question, answer}]`), `bid_type`, `bid_amount`, `connects_estimate`.
