"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { FindingsList } from "@/components/findings";
import { ScoreRing } from "@/components/tailor/score-ring";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

  const missing = ((report?.keywords as Array<Record<string, unknown>>) ?? []).filter(
    (k) => !k.covered,
  );
  const errors = state.findings.filter((f) => f.severity === "error");
  const isTailored = state.resultKind === "tailored_resume";

  return (
    <Card className="border-success/30 gap-0 overflow-hidden py-0">
      <CardHeader className="bg-success/5 flex flex-row items-center gap-3 border-b py-4">
        <span className="bg-success/10 text-success flex size-9 items-center justify-center rounded-lg">
          <CheckCircle2 className="size-5" />
        </span>
        <div className="flex-1">
          <CardTitle>Your resume is ready</CardTitle>
          <p className="text-muted-foreground text-sm">
            {state.needsReview
              ? "Held for review — see the rule findings below before you send it."
              : "Every hard rule passed. Download it, or open it to edit first."}
          </p>
        </div>
        {state.needsReview && <StatusBadge tone="warn">Needs review</StatusBadge>}
      </CardHeader>

      <CardContent className="space-y-6 py-6">
        {(mustHave !== null || niceToHave !== null || gate !== null) && (
          <>
            <div className="flex flex-wrap items-start justify-center gap-8 sm:justify-start">
              {mustHave !== null && (
                <ScoreRing value={mustHave} label="MUST-HAVE coverage" />
              )}
              {niceToHave !== null && (
                <ScoreRing value={niceToHave} label="Nice-to-have" tone="info" />
              )}
              {gate !== null && (
                <ScoreRing value={gate} label="Scenario gate" tone="success" />
              )}
            </div>
            <p className="text-subtle text-xs">
              Counted from the parsed resume by the API, not written by the model — so it
              cannot disagree with the document.
            </p>
            <Separator />
          </>
        )}

        {missing.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="text-warning size-4" />
              Keywords still not covered
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {missing.slice(0, 18).map((k, i) => (
                <li key={i}>
                  <StatusBadge tone="warn">{String(k.keyword)}</StatusBadge>
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
          <div className="overflow-hidden rounded-lg border">
            <FindingsList findings={errors} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
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
            variant="ghost"
            onClick={() =>
              router.push(
                isTailored
                  ? `/resumes/tailored/${state.resultId}`
                  : `/resumes/${state.resultId}`,
              )
            }
          >
            <ExternalLink />
            {isTailored ? "Review and edit" : "Open and edit"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
