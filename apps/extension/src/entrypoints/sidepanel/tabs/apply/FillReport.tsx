import { Copy, ExternalLink, ListChecks, Paperclip, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyNote } from "../../chrome-shell";
import { CopyButton } from "./copy-button";
import type { FillReport } from "./fill-application";

/** The fill engine's reason codes, in words. */
const REASONS: Record<string, string> = {
  "element-gone": "The field changed before it could be filled",
  "option-not-found": "None of the options on the page matched",
  "reverted-by-app": "The form cleared it again — paste it in",
  "file-input": "Attach the file yourself",
  "check-the-upload": "Attached, but the form showed no sign of it — check before sending",
};

interface Gap {
  id: string;
  label: string;
  answer: string;
  badge: string;
  reason: string;
  /** Amber for "probably fine, look", red for "not done". */
  mild: boolean;
}

function gaps(report: FillReport): Gap[] {
  const fromPage = report.results
    .filter((r) => r.status !== "filled")
    .map((r) => ({
      id: r.id,
      label: r.label,
      answer: r.status === "unconfirmed" ? "" : r.intended,
      badge: r.status === "unconfirmed" ? "check" : r.status,
      reason: REASONS[r.reason ?? ""] ?? r.reason ?? "",
      mild: r.status === "reverted" || r.status === "unconfirmed",
    }));
  const fromAnswers = report.unanswered.map((u) => ({
    id: u.id,
    label: u.label,
    answer: u.answer,
    badge: "needs you",
    reason: u.reason,
    mild: false,
  }));
  return [...fromPage, ...fromAnswers];
}

export function FillReportCard({
  report,
  portalUrl,
  busy,
  onRescan,
}: {
  report: FillReport;
  portalUrl: string;
  busy: boolean;
  onRescan: () => void;
}) {
  const filled = report.results.filter((r) => r.status === "filled").length;
  const total = report.results.length + report.unanswered.length;
  const attached = report.results.some((r) => r.reason === "file-attached");
  const needsYou = gaps(report);
  // Uploads and sensitive questions are handed back by design; only these are
  // things a stored profile could have answered.
  const profileGaps = report.unanswered.filter((u) =>
    /not present|profile|missing/i.test(u.reason),
  ).length;

  return (
    <Card className="py-3">
      <CardContent className="space-y-2.5 px-3">
        <div className="flex items-center gap-2">
          <strong className="flex-1 text-xs">
            Filled {filled} of {total}
          </strong>
          <Button size="xs" variant="outline" disabled={busy} onClick={onRescan}>
            Re-scan
          </Button>
        </div>

        {attached && (
          <p className="text-success flex items-center gap-1.5 text-[11px]">
            <Paperclip className="size-3 shrink-0" />
            Attached {report.resume?.display_name ?? "your resume"}.
          </p>
        )}

        {!report.complete && (
          <p className="text-warning text-[11px] leading-snug">
            Some answers could not be worked out this time. Re-scan to try those again.
          </p>
        )}

        {report.unreachable.length > 0 && (
          <p className="text-warning text-[11px] leading-snug">
            {report.unreachable.length} frame(s) could not be reached. If the form is
            embedded, open it directly:{" "}
            <a
              href={report.unreachable[0]}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 underline"
            >
              open form
              <ExternalLink className="size-2.5" />
            </a>
          </p>
        )}

        {!needsYou.length && (
          <EmptyNote icon={ListChecks}>
            Every field was answered. Check them before you submit.
          </EmptyNote>
        )}

        {profileGaps > 0 && (
          <div className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-2.5">
            <p className="text-warning text-[11px] leading-relaxed">
              {profileGaps} field{profileGaps === 1 ? "" : "s"} had no stored answer. The
              filler is not allowed to invent a notice period or a start date — add them once
              and they apply to every form.
            </p>
            <Button asChild size="xs" variant="outline" className="w-full">
              <a href={`${portalUrl}/settings?tab=autofill`} target="_blank" rel="noreferrer">
                <ExternalLink />
                Complete your autofill profile
              </a>
            </Button>
          </div>
        )}

        {needsYou.length > 0 && (
          <>
            <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <TriangleAlert className="text-warning size-3 shrink-0" />
              {needsYou.length} need you — any answer found is here, ready to copy:
            </p>
            <ul className="divide-y">
              {needsYou.map((gap) => (
                <li key={gap.id} className="space-y-1 py-1.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px]" title={gap.label}>
                      {gap.label || "Unlabelled field"}
                    </span>
                    <Badge
                      variant={gap.mild ? "secondary" : "destructive"}
                      className={cn(gap.mild && "bg-warning/10 text-warning")}
                    >
                      {gap.badge}
                    </Badge>
                  </div>
                  {gap.answer && (
                    <div className="flex items-center gap-1.5">
                      <code className="bg-muted min-w-0 flex-1 truncate rounded px-1.5 py-0.5 font-mono text-[10px]">
                        {gap.answer}
                      </code>
                      <CopyButton text={gap.answer} label={gap.label || "answer"} />
                    </div>
                  )}
                  {gap.reason && (
                    <p className="text-muted-foreground text-[10px] leading-snug">{gap.reason}</p>
                  )}
                </li>
              ))}
            </ul>
            {needsYou.some((g) => g.answer) && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    needsYou
                      .filter((g) => g.answer)
                      .map((g) => `${g.label}: ${g.answer}`)
                      .join("\n"),
                  )
                }
              >
                <Copy />
                Copy all as text
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
