"use client";

import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileDown } from "lucide-react";
import { useRouter } from "next/navigation";

import { ScoreRing } from "@/components/remote/tailor/score-ring";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tile } from "@/components/tile";
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

  return (
    <Card className="gap-0 overflow-hidden rounded-[2.25rem] p-0">
      <div className="bg-accent flex flex-wrap items-center gap-4 px-6 py-6 md:px-[30px]">
        <Tile icon={CheckCircle2} tone="ink" size="lg" className="rounded-full" />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[1.4375rem] leading-tight font-medium">
            Your resume is ready
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm font-medium">
            {state.needsReview
              ? "Held for review — see the rule findings before you send it."
              : "Every hard rule passed. Download it, or open it to edit first."}
          </p>
        </div>
        {state.needsReview && (
          <StatusBadge tone="warn" className="bg-card h-8 px-4 text-[0.8125rem]">
            Needs review
          </StatusBadge>
        )}
      </div>

      <div className="grid gap-8 px-6 pt-7 pb-8 md:px-[30px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <div className="space-y-4">
          {(mustHave !== null || niceToHave !== null || gate !== null) && (
            <>
              <div className="grid gap-3.5 sm:grid-cols-3">
                {mustHave !== null && (
                  <ScoreRing
                    value={mustHave}
                    label="Must-have coverage"
                    detail={
                      typeof mustCovered === "number" && typeof mustTotal === "number"
                        ? `${mustCovered} of ${mustTotal} requirements`
                        : undefined
                    }
                  />
                )}
                {niceToHave !== null && (
                  <ScoreRing
                    value={niceToHave}
                    label="Nice-to-have"
                    detail="Optional keywords"
                    tone="info"
                  />
                )}
                {gate !== null && (
                  <ScoreRing
                    value={gate}
                    label="Scenario gate"
                    detail={`${String(gatePassed)} of ${String(gateTotal)} passed`}
                    tone="success"
                  />
                )}
              </div>
              <p className="text-muted-foreground text-[0.8125rem] font-medium">
                Counted from the parsed resume by the API, not written by the model — so it cannot
                disagree with the document.
              </p>
            </>
          )}
        </div>

        <div className="space-y-[18px]">
          {missing.length > 0 && (
            <div className="space-y-2.5">
              <p className="flex items-center gap-2 text-[0.9375rem] font-bold">
                <AlertTriangle className="text-warning size-[18px]" />
                Keywords still not covered
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {missing.slice(0, 18).map((k, i) => (
                  <li key={i}>
                    <StatusBadge tone="warn" className="h-[26px] px-3">
                      {String(k.keyword)}
                    </StatusBadge>
                  </li>
                ))}
                {missing.length > 18 && (
                  <li className="text-muted-foreground self-center text-xs">
                    +{missing.length - 18} more
                  </li>
                )}
              </ul>
            </div>
          )}

          {errors.length > 0 && (
            <ul className="space-y-2.5">
              {errors.map((f, i) => (
                <li
                  key={`${f.rule_id}-${i}`}
                  className="bg-destructive/10 flex min-w-0 items-start gap-3.5 rounded-[20px] px-[18px] py-3.5"
                >
                  <StatusBadge tone="bad" className="bg-card mt-px shrink-0">
                    {f.severity}
                  </StatusBadge>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9063rem] font-semibold break-words">{f.message}</p>
                    {f.suggested_fix && (
                      <p className="text-muted-foreground mt-[3px] text-[0.8125rem]">
                        Fix: {f.suggested_fix}
                      </p>
                    )}
                    <code className="text-muted-foreground mt-1.5 block font-mono text-[11px]">
                      {f.rule_id}
                    </code>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button
              size="lg"
              className="px-5"
              onClick={() =>
                downloadDocx({
                  resume_id: state.resultId,
                  kind: isTailored ? "tailored" : "base",
                  profile: "designed",
                })
              }
            >
              <Download />
              Download .docx
            </Button>
            <Button
              size="lg"
              className="px-5"
              variant="outline"
              onClick={() =>
                downloadDocx({
                  resume_id: state.resultId,
                  kind: isTailored ? "tailored" : "base",
                  profile: "ats_plain",
                })
              }
            >
              <FileDown />
              ATS version
            </Button>
            <Button
              size="lg"
              className="px-5"
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
          </div>
        </div>
      </div>
    </Card>
  );
}
