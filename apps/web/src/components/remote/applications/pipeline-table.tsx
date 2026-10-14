"use client";

import { ExternalLink } from "lucide-react";
import { useMemo } from "react";

import { StageMenu } from "@/components/remote/applications/stage-menu";
import { StatusSelect } from "@/components/remote/applications/status-select";
import { CompanyMark, StepMark } from "@/components/remote/applications/step-mark";
import type { Meeting } from "@/lib/calendar";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CLOSED_STATUSES,
  stageColumns,
  stageStatus,
  type ApplicationRow,
  type Stage,
} from "./shared";

/** Rows past their end sit back; the open one fills with the accent. */
function rowSurface(row: ApplicationRow, active: boolean) {
  if (active) return "bg-brand text-brand-foreground";
  if (CLOSED_STATUSES.has(row.status)) {
    return "bg-[color-mix(in_oklab,var(--card)_60%,var(--background))]";
  }
  return "bg-card";
}

/** Steps that have not happened (and never will, or not yet) are not where an application stands. */
const NOT_REACHED = new Set(["pending", "skipped", "cancelled"]);

/**
 * Where an application stands: the furthest step that has been reached, in any
 * state (passed, booked, waiting on feedback, failed). Nothing reached yet
 * leaves the first step as the one to act on.
 */
function currentStageName(row: ApplicationRow, columns: string[]): string | undefined {
  let current: string | undefined;
  for (const name of columns) {
    const stage = row.stages.find((candidate) => candidate.name === name);
    if (stage && !NOT_REACHED.has(stage.status)) current = name;
  }
  return current ?? columns.find((name) => row.stages.some((stage) => stage.name === name));
}

/**
 * The tracking table: one row per application, one column per interview step.
 *
 * A cell is that step's status. Clicking it opens the step's menu — schedule,
 * edit the booked call, or set the status — and clicking anywhere else on the
 * row opens the application.
 *
 * Each row's current step is drawn a little wider than the rest, a blade of
 * the fan standing proud of its neighbours. It borrows the spare padding of
 * the cells either side rather than widening its column, so the headers stay
 * where they are. When the rows change, the cells flip open left to right.
 */
export function PipelineTable({
  rows,
  pending,
  activeId,
  onOpen,
  onStatus,
  onStageStatus,
  onSchedule,
  onEditMeeting,
}: {
  rows: ApplicationRow[];
  pending: boolean;
  /** The application open in the sheet, drawn in the accent. */
  activeId?: string | null;
  onOpen: (row: ApplicationRow) => void;
  onStatus: (row: ApplicationRow, status: string) => void;
  onStageStatus: (row: ApplicationRow, stage: Stage, status: string) => void;
  onSchedule: (row: ApplicationRow, stage: Stage) => void;
  onEditMeeting: (row: ApplicationRow, stage: Stage, meeting: Meeting) => void;
}) {
  const columns = useMemo(() => stageColumns(rows), [rows]);

  return (
    <div className="space-y-4">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <table className="w-full border-separate border-spacing-x-0 border-spacing-y-2">
          <thead>
            <tr className="text-subtle text-[0.6875rem] font-bold tracking-[0.06em] uppercase">
              <th scope="col" className="min-w-56 px-5 pb-1 text-left font-bold">
                Application
              </th>
              <th scope="col" className="min-w-36 px-2 pb-1 text-left font-bold">
                Status
              </th>
              {columns.map((name, index) => (
                <th
                  key={name}
                  scope="col"
                  className="w-[4.25rem] min-w-[4.25rem] px-1 pb-1 align-bottom text-[0.65rem] leading-tight font-semibold tracking-normal normal-case"
                >
                  <span className="text-subtle block text-[0.6875rem] font-bold">{index + 1}</span>
                  <span className="text-muted-foreground block">{name}</span>
                </th>
              ))}
              <th scope="col" className="px-5 pb-1 text-right font-bold">
                Match
              </th>
            </tr>
          </thead>
          {/* Re-keyed by the set of rows shown, so the flip replays on load and on a
              filter or search, but not when one row's status changes. */}
          <tbody key={rows.map((row) => row.id).join(",")}>
            {rows.map((row, rowIndex) => {
              const current = currentStageName(row, columns);
              const active = row.id === activeId;
              const surface = rowSurface(row, active);
              const byName = new Map(row.stages.map((stage) => [stage.name, stage]));
              return (
                <tr
                  key={row.id}
                  // One shadow for the whole row: a shadow on each cell leaves seams between them.
                  className={cn(
                    "cursor-pointer",
                    !active && !CLOSED_STATUSES.has(row.status) && "drop-shadow-[0_12px_14px_rgb(40_25_10/0.07)]",
                  )}
                  onClick={() => onOpen(row)}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-10 h-[7.25rem] rounded-l-3xl py-3 pr-2 pl-5 transition-colors",
                      surface,
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <CompanyMark name={row.company_name} />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left outline-none focus-visible:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(row);
                        }}
                      >
                        <span className="block max-w-44 truncate text-[0.9375rem] leading-tight font-bold">
                          {row.company_name}
                        </span>
                        <span
                          className={cn(
                            "mt-px block max-w-44 truncate text-[0.78rem] font-medium",
                            active ? "text-brand-foreground/65" : "text-muted-foreground",
                          )}
                        >
                          {row.role_title}
                        </span>
                      </button>
                      {row.job_url && (
                        <a
                          href={row.job_url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open the ${row.company_name} posting`}
                          className="opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                  </td>

                  <td className={cn("px-2", surface)} onClick={(event) => event.stopPropagation()}>
                    <div className="w-32">
                      <StatusSelect
                        value={row.status}
                        disabled={pending}
                        raised={active}
                        label={`Status for ${row.company_name}`}
                        onChange={(status) => onStatus(row, status)}
                      />
                    </div>
                  </td>

                  {columns.map((name, columnIndex) => {
                    const stage = byName.get(name);
                    const isCurrent = name === current;
                    return (
                      <td
                        key={name}
                        className={cn("relative px-0 pb-3 align-bottom text-center", isCurrent && "z-[2]", surface)}
                        // Menu items render in a portal, but React still bubbles
                        // their clicks through here; stop them opening the row.
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div
                          className={cn(
                            "fan-flip",
                            isCurrent && "relative -mx-2 w-[calc(100%+1rem)]",
                          )}
                          style={
                            {
                              "--fan-i": columnIndex,
                              "--fan-r": Math.min(rowIndex, 8),
                            } as React.CSSProperties
                          }
                        >
                          {stage ? (
                            <StageMenu
                              stage={stage}
                              disabled={pending}
                              onStatus={(status) => onStageStatus(row, stage, status)}
                              onSchedule={() => onSchedule(row, stage)}
                              onEditMeeting={(meeting) => onEditMeeting(row, stage, meeting)}
                            >
                              <StageCell
                                stage={stage}
                                raised={active}
                                current={isCurrent}
                                index={columnIndex}
                                total={columns.length}
                              />
                            </StageMenu>
                          ) : (
                            <span aria-hidden className="text-subtle block pb-9 text-sm">
                              —
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}

                  <td
                    className={cn(
                      "rounded-r-3xl pr-5 pl-2 text-right text-[0.84rem] font-bold tabular-nums",
                      surface,
                    )}
                  >
                    {row.must_have_coverage_percent != null ? (
                      `${Math.round(row.must_have_coverage_percent)}%`
                    ) : (
                      <span className="text-subtle font-medium">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <StepLegend count={rows.length} />
    </div>
  );
}

/** The colour under a fold, by the step's state, on a white row or on the accent row. */
function foldTone(status: string, raised: boolean) {
  switch (status) {
    case "passed":
      return raised ? "bg-white/60" : "bg-success/16";
    case "scheduled":
      return "bg-panel";
    case "in_progress":
      return raised ? "bg-white/60" : "bg-info/16";
    case "waiting_feedback":
    case "rescheduled":
    case "no_show":
      return raised ? "bg-white/60" : "bg-warning/22";
    case "failed":
      return raised ? "bg-white/60" : "bg-destructive/16";
    case "skipped":
    case "cancelled":
      return raised ? "bg-white/15" : "bg-foreground/[0.035]";
    default:
      return raised ? "bg-white/28" : "bg-foreground/[0.06]";
  }
}

/**
 * One step as a fold of the fan. The folds stand side by side with creased,
 * alternating shading; their tops follow an arc and each leans a little away
 * from the middle, so the row opens like a paper fan. The current step stands
 * taller and wider than its neighbours.
 */
function StageCell({
  stage,
  raised,
  current = false,
  index,
  total,
  ...props
}: {
  stage: Stage;
  raised: boolean;
  current?: boolean;
  index: number;
  total: number;
} & React.ComponentProps<"button">) {
  const { label } = stageStatus(stage.status);
  const booked =
    stage.status === "scheduled" ? stage.meetings.find((m) => m.status === "scheduled") : null;
  const when = booked?.starts_at ?? (stage.status === "scheduled" ? stage.scheduled_for : null);
  const dark = stage.status === "scheduled";

  // Where this fold sits across the fan, -1 (first) to 1 (last).
  const across = total > 1 ? (2 * index) / (total - 1) - 1 : 0;
  const height = Math.round(66 + 22 * (1 - across * across)) + (current ? 8 : 0);
  // A steady lean per fold, so a long row fans out as far as a short one.
  const tilt = (index - (total - 1) / 2) * Math.min(1.9, 14 / Math.max(total - 1, 1));

  return (
    <button
      type="button"
      aria-label={`${stage.name}: ${label}${when ? `, ${formatDateTime(when, "d MMM, HH:mm")}` : ""}`}
      aria-current={current ? "step" : undefined}
      className={cn(
        "group/fold focus-visible:ring-ring/40 relative flex h-[6.5rem] w-full flex-col items-center justify-end gap-[3px] px-0.5 pb-2.5 text-[0.65rem] leading-tight font-semibold outline-none focus-visible:ring-3",
        dark
          ? "text-panel-foreground"
          : raised
            ? "text-brand-foreground/75"
            : "text-muted-foreground",
        stage.status === "passed" && !raised && "text-foreground/70",
        (stage.status === "skipped" || stage.status === "cancelled") && "text-subtle",
        current && !dark && "text-foreground",
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pleat absolute inset-x-[-1px] bottom-0 origin-bottom rounded-t-[24px] rounded-b-[10px] transition-transform duration-200",
          index % 2 === 1 && "pleat-alt",
          foldTone(stage.status, raised),
          "[transform:rotate(var(--tilt))] group-hover/fold:[transform:translateY(-5px)_rotate(var(--tilt))] group-aria-expanded/fold:[transform:translateY(-5px)_rotate(var(--tilt))]",
          current && "shadow-[0_10px_20px_-10px_rgb(40_25_10/0.55)]",
        )}
        style={{ height, "--tilt": `${tilt}deg` } as React.CSSProperties}
      />
      <span className="relative flex flex-col items-center gap-[3px]">
        <StepMark status={stage.status} raised={raised} onDark={dark} />
        <span className="max-w-[4.4rem] text-center leading-[1.15] text-balance">{label}</span>
        {when && (
          <span className="text-[0.6rem] font-medium whitespace-nowrap tabular-nums opacity-75">
            {formatDateTime(when, "d MMM, HH:mm")}
          </span>
        )}
      </span>
    </button>
  );
}

const LEGEND = ["passed", "scheduled", "in_progress", "pending", "failed", "skipped"];

/** The key to the marks, with the number of rows shown. */
function StepLegend({ count }: { count: number }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3.5 gap-y-2 px-2 text-[0.8125rem] font-semibold">
      <span className="text-subtle text-[0.6875rem] font-bold tracking-[0.06em] uppercase">
        Step status
      </span>
      {LEGEND.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <StepMark status={status} size="sm" />
          {stageStatus(status).label}
        </span>
      ))}
      <span className="ml-auto tabular-nums">
        {count} {count === 1 ? "application" : "applications"}
      </span>
    </div>
  );
}
