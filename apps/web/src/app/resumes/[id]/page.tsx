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
  content_md: string;
  ats_report: Record<string, unknown> | null;
  ledger: Record<string, unknown> | null;
  flags: Record<string, unknown> | null;
  validation: { findings?: Finding[] } | null;
}

type Panel = "validation" | "ats" | "ledger" | "flags";

export default function ResumeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("validation");
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["resume", id],
    queryFn: () => request<Resume>(`/api/v1/resumes/${id}`),
  });

  useEffect(() => {
    if (data && draft === null) setDraft(data.content_md);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: (content_md: string) =>
      request<Resume & { findings: Finding[] }>(`/api/v1/resumes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content_md }),
      }),
    onSuccess: (updated) => {
      setSaveError(null);
      qc.setQueryData(["resume", id], updated);
      qc.invalidateQueries({ queryKey: ["resumes"] });
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
  const dirty = draft !== data.content_md;

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

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card
          title="Canonical Resume Markdown"
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

        <div className="space-y-4">
          <Card>
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
            {panel === "flags" && <JsonPanel value={data.flags} empty="No interview-prep block for this resume." />}
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
          ["MUST-HAVE coverage", `${stat("must_have_covered")}/${stat("must_have_total")} · ${stat("must_have_coverage_pct")}%`],
          ["Nice-to-have", `${stat("nice_to_have_coverage_pct")}%`],
          ["Years required / shown", `${stat("yoe_required")} / ${stat("yoe_shown")}`],
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
        <div className="max-h-72 overflow-auto">
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
    <pre className="mono max-h-96 overflow-auto px-4 py-3 text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
