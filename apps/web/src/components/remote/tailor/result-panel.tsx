"use client";

import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileDown } from "lucide-react";
import { useRouter } from "next/navigation";

import { Panel, PanelHead } from "@/components/panel";
import { PdfButton } from "@/components/remote/pdf-button";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { GenerationState } from "@/hooks/use-generation";
import { downloadDocx } from "@/lib/api";

function percent(report: Record<string, unknown> | null, key: string): number | null {
  const raw = report?.[key];
  return typeof raw === "number" ? raw : null;
}

/**
 * What came back, led by the numbers the backend actually computed.
 *
 * Every figure here is counted from the parsed document by the API - none of
 * it is the model's own self-assessment, and nothing is shown when the report
 * did not include it.
 */
export function ResultPanel({ state }: { state: GenerationState }) {
  const router = useRouter();
  const report = state.report;

  const mustHave = percent(report, "must_have_coverage_percent");
  const niceToHave = percent(report, "nice_to_have_coverage_percent");
  const gatePassed = report?.scenario_gate_passed;
  const gateTotal = report?.scenario_gate_total;
  const gate =
    typeof gatePassed === "number" && typeof gateTotal === "number" && gateTotal > 0
      ? (gatePassed / gateTotal) * 100
      : null;

  const mustCovered = report?.must_have_covered;
  const mustTotal = report?.must_have_total;

  const missing = ((report?.keywords as Array<Record<string, unknown>>) ?? []).filter(
    (k) => !k.covered,
  );
  const errors = state.findings.filter((f) => f.severity === "error");
  const isTailored = state.resultKind === "tailored_resume";

  const kind = isTailored ? "tailored" : "base";
  const stats: { label: string; value: string; detail?: string }[] = [];
  if (mustHave !== null) {
    stats.push({
      label: "Must-have",
      value: `${Math.round(mustHave)}%`,
      detail:
        typeof mustCovered === "number" && typeof mustTotal === "number"
          ? `${mustCovered}/${mustTotal}`
          : undefined,
    });
  }
  if (niceToHave !== null) stats.push({ label: "Nice-to-have", value: `${Math.round(niceToHave)}%` });
  if (gate !== null) {
    stats.push({ label: "Scenario gate", value: `${String(gatePassed)}/${String(gateTotal)}` });
  }

  return (
    <Panel>
      <PanelHead
        title={
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="text-success size-4" />
            Your resume is ready
          </span>
        }
      >
        {state.needsReview && <StatusBadge tone="warn">Needs review</StatusBadge>}
      </PanelHead>

      {stats.length > 0 && (
        <dl className="bg-border grid grid-cols-3 gap-px border-b">
          {stats.map(({ label, value, detail }) => (
            <div key={label} className="bg-card px-3 py-1.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="font-semibold tabular-nums">
                {value}
                {detail && <span className="text-muted-foreground ml-1 text-xs font-normal">{detail}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-2 p-3">
        {missing.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <AlertTriangle className="text-warning size-3.5" />
              Keywords still not covered
            </p>
            <ul className="flex flex-wrap gap-1">
              {missing.slice(0, 18).map((k, i) => (
                <li key={i}>
                  <StatusBadge tone="warn">{String(k.keyword)}</StatusBadge>
                </li>
              ))}
              {missing.length > 18 && (
                <li className="text-muted-foreground self-center text-xs">+{missing.length - 18} more</li>
              )}
            </ul>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="space-y-1">
            {errors.map((f, i) => (
              <li
                key={`${f.rule_id}-${i}`}
                className="bg-destructive/10 flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5"
              >
                <StatusBadge tone="bad" className="shrink-0">
                  {f.severity}
                </StatusBadge>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-medium break-words">{f.message}</p>
                  {f.suggested_fix && <p className="text-muted-foreground">Fix: {f.suggested_fix}</p>}
                  <code className="text-muted-foreground font-mono text-[11px]">{f.rule_id}</code>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="brand"
            onClick={() =>
              router.push(
                isTailored
                  ? `/remote/resumes/tailored/${state.resultId}`
                  : `/remote/resumes/${state.resultId}`,
              )
            }
          >
            <ExternalLink />
            {isTailored ? "Review and edit" : "Open and edit"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadDocx({ resume_id: state.resultId, kind, profile: "designed" })}
          >
            <Download />
            .docx
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadDocx({ resume_id: state.resultId, kind, profile: "ats_plain" })}
          >
            <FileDown />
            ATS version
          </Button>
          <PdfButton
            size="sm"
            variant="outline"
            body={{ resume_id: state.resultId, kind, profile: "designed" }}
            filename="Resume.pdf"
          >
            PDF
          </PdfButton>
        </div>
      </div>
    </Panel>
  );
}
