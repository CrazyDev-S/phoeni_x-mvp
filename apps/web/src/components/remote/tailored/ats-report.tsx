import { Check } from "lucide-react";

import { PanelNote } from "@/components/remote/resume-editor";
import { cn } from "@/lib/utils";

const COLUMNS = "grid-cols-[minmax(0,1.8fr)_0.7fr_0.62fr_0.85fr_0.75fr]";

/**
 * A tailored resume's ATS report: the counts as soft tiles, then one row per
 * keyword with where it was found. Missing keywords are tinted.
 *
 * Every figure is computed by the API from the parsed document.
 */
export function AtsReport({ report }: { report: Record<string, unknown> | null }) {
  if (!report) {
    return (
      <PanelNote>
        No ATS report — generate or tailor this resume against a job description to get one.
      </PanelNote>
    );
  }
  const rows = (report.keywords as Array<Record<string, unknown>>) ?? [];
  const stat = (k: string) => String(report[k] ?? "—");

  const facts: [string, string][] = [
    [
      "Must-have coverage",
      `${stat("must_have_covered")}/${stat("must_have_total")} · ${stat("must_have_coverage_percent")}%`,
    ],
    ["Nice-to-have", `${stat("nice_to_have_coverage_percent")}%`],
    ["Years required / shown", `${stat("years_required")} / ${stat("years_shown")}`],
    ["Scenario gate", `${stat("scenario_gate_passed")}/${stat("scenario_gate_total")}`],
    ["Parse integrity", stat("parse_integrity")],
    ["Companies · categories", `${stat("companies")} · ${stat("skill_categories")}`],
  ];

  return (
    <div className="min-w-0 p-5 pt-1">
      <dl className="grid grid-cols-2 gap-2.5">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-soft rounded-[20px] px-4 py-3.5">
            <dt className="text-muted-foreground text-xs font-semibold">{label}</dt>
            <dd className="mt-[3px] text-[1.1875rem] font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {rows.length > 0 && (
        <div role="table" aria-label="Keyword coverage" className="mt-5 overflow-x-auto">
          <div className="min-w-[26rem]">
            <div
              role="row"
              className={cn(
                "text-subtle grid h-[30px] items-center gap-2 px-3.5 text-[0.7188rem] font-bold tracking-[0.06em] uppercase",
                COLUMNS,
              )}
            >
              {["Keyword", "Priority", "Skills", "Experience", "Summary"].map((h) => (
                <span key={h} role="columnheader">
                  {h}
                </span>
              ))}
            </div>
            {rows.map((row, i) => (
              <div
                key={i}
                role="row"
                className={cn(
                  "grid h-[42px] items-center gap-2 rounded-[14px] px-3.5 text-[0.8438rem] font-semibold",
                  COLUMNS,
                  !row.covered && "bg-destructive/10",
                )}
              >
                <span role="cell" className="truncate">
                  {String(row.keyword)}
                </span>
                <span role="cell" className="text-muted-foreground font-medium">
                  {String(row.priority)}
                </span>
                {(["skills", "experience", "summary"] as const).map((k) => (
                  <span key={k} role="cell" className="pl-1.5">
                    {row[k] ? (
                      <span
                        className="bg-success/15 text-success inline-grid size-[22px] place-items-center rounded-full"
                        aria-label="Found"
                      >
                        <Check className="size-3 stroke-[3]" />
                      </span>
                    ) : (
                      <span className="text-subtle font-medium" aria-label="Not found">
                        —
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-muted-foreground border-border mt-[18px] border-t pt-4 text-[0.8125rem] leading-relaxed font-medium">
        Every count here is computed from the parsed resume, not written by the model — so it cannot
        disagree with the document.
      </p>
    </div>
  );
}
