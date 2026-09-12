"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { FindingsList, type Finding } from "@/components/findings";
import { Badge, Button, Card, ErrorNote, Spinner, Textarea } from "@/components/ui";
import { downloadDocx, request } from "@/lib/api";

interface Resume {
  id: string;
  display_name: string;
  target_title: string;
  status: string;
  mode: string;
  content_markdown: string;
  ats_report: Record<string, unknown> | null;
  ledger: Record<string, unknown> | null;
  flags: Record<string, unknown> | null;
  validation: { findings?: Finding[] } | null;
}

type Panel = "validation" | "ats" | "ledger" | "flags";

export default function ResumeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("validation");
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["resume", id],
    queryFn: () => request<Resume>(`/api/v1/resumes/${id}`),
  });

  useEffect(() => {
    if (data && draft === null) setDraft(data.content_markdown);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: (content_markdown: string) =>
      request<Resume & { findings: Finding[] }>(`/api/v1/resumes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content_markdown }),
      }),
    onSuccess: (updated) => {
      setSaveError(null);
      queryClient.setQueryData(["resume", id], updated);
      queryClient.invalidateQueries({ queryKey: ["resumes"] });
    },
    onError: (err) => {
      const e = err as { message?: string; detail?: Record<string, unknown> };
      setSaveError(
        e.detail?.line
          ? `${e.message} (line ${e.detail.line} in ${e.detail.section})`
          : (e.message ?? "Could not save"),
      );
    },
  });

  if (isLoading || !data || draft === null) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[var(--color-ink-soft)]">
        <Spinner /> Loading…
      </div>
    );
  }

  const findings = data.validation?.findings ?? [];
  const dirty = draft !== data.content_markdown;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {data.display_name}
            {data.status === "needs_review" && <Badge tone="warn">Needs review</Badge>}
          </h1>
          <p className="text-sm text-[var(--color-ink-soft)]">{data.target_title}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              downloadDocx(
                { resume_id: id, kind: "base", profile: "designed" },
                `${data.display_name}.docx`,
              )
            }
          >
            Download .docx
          </Button>
          <Button
            onClick={() =>
              downloadDocx(
                { resume_id: id, kind: "base", profile: "ats_plain" },
                `${data.display_name}_ATS.docx`,
              )
            }
            title="Single column, no table — for Workday and Taleo upload forms"
          >
            ATS version
          </Button>
          <Button
            variant="primary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>

      {saveError && <ErrorNote>{saveError}</ErrorNote>}

      {/* min-w-0 on both tracks is load-bearing: a grid `1fr` is
          `minmax(auto, 1fr)`, and `auto` resolves to min-content — so one wide
          child (the JSON block) expands its column and crushes the other. */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card
          className="min-w-0"
          title="Resume Markdown"
          action={
            <span className="text-xs text-[var(--color-ink-soft)]">
              {dirty ? "Unsaved edits" : "In sync"}
            </span>
          }
        >
          <Textarea
            rows={30}
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="mono rounded-none border-0 text-xs focus:ring-0"
          />
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="min-w-0">
            <div className="flex gap-1 border-b border-[var(--color-line)] p-1">
              {(
                [
                  ["validation", `Rules${findings.length ? ` (${findings.length})` : ""}`],
                  ["ats", "ATS report"],
                  ["ledger", "Ledger"],
                  ["flags", "Prep"],
                ] as [Panel, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPanel(key)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                    panel === key
                      ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]"
                      : "text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {panel === "validation" && <FindingsList findings={findings} />}
            {panel === "ats" && <AtsPanel report={data.ats_report} />}
            {panel === "ledger" && <JsonPanel value={data.ledger} empty="No scenario ledger — this resume was uploaded, not generated." />}
            {panel === "flags" && (
              <PrepPanel
                value={data.flags as Flags | null}
                empty="No interview-prep block for this resume."
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function AtsPanel({ report }: { report: Record<string, unknown> | null }) {
  if (!report) {
    return (
      <p className="px-4 py-6 text-sm text-[var(--color-ink-soft)]">
        No ATS report — generate or tailor this resume against a job description
        to get one.
      </p>
    );
  }
  const rows = (report.keywords as Array<Record<string, unknown>>) ?? [];
  const stat = (k: string) => String(report[k] ?? "—");

  return (
    <div>
      <dl className="grid grid-cols-2 gap-px bg-[var(--color-line)] text-sm">
        {[
          ["MUST-HAVE coverage", `${stat("must_have_covered")}/${stat("must_have_total")} · ${stat("must_have_coverage_percent")}%`],
          ["Nice-to-have", `${stat("nice_to_have_coverage_percent")}%`],
          ["Years required / shown", `${stat("years_required")} / ${stat("years_shown")}`],
          ["Scenario gate", `${stat("scenario_gate_passed")}/${stat("scenario_gate_total")}`],
          ["Parse integrity", stat("parse_integrity")],
          ["Companies · categories", `${stat("companies")} · ${stat("skill_categories")}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--color-surface)] px-4 py-3">
            <dt className="text-xs text-[var(--color-ink-soft)]">{label}</dt>
            <dd className="mt-0.5 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {rows.length > 0 && (
        <div className="max-h-72 min-w-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--color-canvas)] text-[var(--color-ink-soft)]">
              <tr>
                {["Keyword", "Priority", "Skills", "Experience", "Summary"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((row, i) => (
                <tr key={i} className={row.covered ? "" : "bg-red-50/50"}>
                  <td className="px-3 py-1.5">{String(row.keyword)}</td>
                  <td className="px-3 py-1.5">{String(row.priority)}</td>
                  {(["skills", "experience", "summary"] as const).map((k) => (
                    <td key={k} className="px-3 py-1.5">{row[k] ? "yes" : "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-ink-soft)]">
        Every count here is computed from the parsed resume, not written by the
        model — so it cannot disagree with the document.
      </p>
    </div>
  );
}

function JsonPanel({ value, empty }: { value: unknown; empty: string }) {
  if (!value) {
    return <p className="px-4 py-6 text-sm text-[var(--color-ink-soft)]">{empty}</p>;
  }
  return (
    <pre className="mono max-h-96 min-w-0 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

interface Flags {
  must_verify?: string[];
  interview_probes?: { question: string; suggested_answer: string }[];
  estimated_figures?: { figure: string; where: string; derivation: string }[];
  uncovered_requirements?: { requirement: string; how_to_close: string }[];
  notes?: string;
}

/**
 * The interview-prep block, rendered rather than dumped.
 *
 * This is the sheet you read before a call, so raw JSON is the wrong shape for
 * it. The original object stays available underneath for anything the schema
 * does not cover.
 */
function PrepPanel({ value, empty }: { value: Flags | null; empty: string }) {
  if (!value) {
    return <p className="px-4 py-6 text-sm text-[var(--color-ink-soft)]">{empty}</p>;
  }

  const sections: [string, React.ReactNode][] = [];

  if (value.must_verify?.length) {
    sections.push([
      "Verify before sending",
      <ul key="verify" className="list-disc space-y-1 pl-5">
        {value.must_verify.map((item, i) => (
          <li key={i} className="break-words">{item}</li>
        ))}
      </ul>,
    ]);
  }

  if (value.interview_probes?.length) {
    sections.push([
      "Questions this timeline invites",
      <dl key="probes" className="space-y-3">
        {value.interview_probes.map((probe, i) => (
          <div key={i}>
            <dt className="font-medium break-words">{probe.question}</dt>
            <dd className="mt-0.5 break-words text-[var(--color-ink-soft)]">
              {probe.suggested_answer}
            </dd>
          </div>
        ))}
      </dl>,
    ]);
  }

  if (value.estimated_figures?.length) {
    sections.push([
      "Every number, and where it came from",
      <ul key="figures" className="space-y-2">
        {value.estimated_figures.map((figure, i) => (
          <li key={i} className="break-words">
            <span className="mono font-medium">{figure.figure}</span>
            {figure.where && (
              <span className="text-[var(--color-ink-soft)]"> · {figure.where}</span>
            )}
            {figure.derivation && (
              <span className="block text-[var(--color-ink-soft)]">
                {figure.derivation}
              </span>
            )}
          </li>
        ))}
      </ul>,
    ]);
  }

  if (value.uncovered_requirements?.length) {
    sections.push([
      "Not covered by this resume",
      <ul key="gaps" className="space-y-2">
        {value.uncovered_requirements.map((gap, i) => (
          <li key={i} className="break-words">
            {gap.requirement}
            {gap.how_to_close && (
              <span className="block text-[var(--color-ink-soft)]">
                {gap.how_to_close}
              </span>
            )}
          </li>
        ))}
      </ul>,
    ]);
  }

  if (!sections.length) return <JsonPanel value={value} empty={empty} />;

  return (
    <div className="max-h-[32rem] min-w-0 overflow-y-auto">
      {sections.map(([heading, body]) => (
        <section key={heading} className="border-b border-[var(--color-line)] px-4 py-3 last:border-0">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            {heading}
          </h3>
          <div className="space-y-1 text-sm">{body}</div>
        </section>
      ))}
      {value.notes && (
        <p className="break-words px-4 py-3 text-sm text-[var(--color-ink-soft)]">
          {value.notes}
        </p>
      )}
      <details className="border-t border-[var(--color-line)] px-4 py-2">
        <summary className="cursor-pointer text-xs text-[var(--color-ink-soft)]">
          Raw data
        </summary>
        <JsonPanel value={value} empty={empty} />
      </details>
    </div>
  );
}
