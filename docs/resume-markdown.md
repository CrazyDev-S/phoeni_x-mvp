# Resume Markdown v1

Resumes are stored as markdown. Because the `.docx` exporter has to read that
markdown back, the format is a **strict, versioned dialect** rather than
free-form prose: exactly one line shape per construct, so the parser never
guesses. The LLM is instructed to emit this; `app/resume/parser.py` validates
it; the `markdown_version` column records which grammar a row was written under.

## Grammar

| Construct | Line shape |
|---|---|
| Header | YAML frontmatter between `---` fences, one field per line |
| Section | `## ` + a heading from the fixed set below |
| Skill category | `- **Label**: item, item, item` |
| Company | `### {Company} — {City}, {Country} ({Mode})` |
| Company tenure | `**{Mon YYYY} – {Mon YYYY\|Present}**` on the next line |
| Context line | `> {text}` |
| Title block | `#### {Title} · {Mon YYYY} – {Mon YYYY\|Present}` |
| Promotion note | `*{text}*`, directly under a title line |
| Bullet | `- {text}` |
| Education entry | `### {Degree}` then `{Institution} — {City}, {Country} · {Year}` |
| Language | `- {Language} — {Proficiency}` |
| Certification | `- {Name} — {Issuer}, {Year}` |

Allowed section headings, in this order: `PROFESSIONAL SUMMARY`,
`TECHNICAL SKILLS`, `PROFESSIONAL EXPERIENCE`, `SELECTED PROJECTS`,
`EDUCATION`, `CERTIFICATIONS`, `LANGUAGES`.

## Notes

- **The company tenure line is required whenever a company has two title
  blocks** (the promotion case). With a single title it may be omitted and is
  derived from that title's dates.
- **Title blocks are newest first**, and only the newest may be `Present`.
- **A company name may contain its own parentheses.** `### KASIKORN
  Business-Technology Group (KBTG) — Bangkok, Thailand (On-site)` parses
  correctly: the work mode is the *last* parenthetical.
- Dates are `Mon YYYY` (three-letter English month) or a bare `YYYY`. Ranges
  accept any of `–`, `—`, `-` as the separator and render as `–`.

## The round-trip property

`parse(render(parse(md))) == parse(md)`, asserted in `tests/test_resume_markdown.py`. Any
change to the grammar must keep this true — it is the guarantee that editing a
resume in the portal and re-exporting it cannot corrupt the document.

## On parse failure

`ResumeMarkdownError` carries the line number, the section being read, and the
offending line. The API surfaces this as a `422 RESUME_MARKDOWN_PARSE_ERROR` so the editor
can point at the problem, and the generation pipeline uses it to drive a single
bounded repair turn. The exporter never attempts a best-effort render of a
document it could not parse — a mangled resume is worse than an error.
