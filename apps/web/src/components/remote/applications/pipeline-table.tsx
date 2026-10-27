"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { ExternalLink, MoreHorizontal, PanelRightOpen } from "lucide-react";
import { useMemo } from "react";

import { StageMenu } from "@/components/remote/applications/stage-menu";
import { CompanyMark, StepMark } from "@/components/remote/applications/step-mark";
import { Panel } from "@/components/panel";
import { StatusSelect } from "@/components/remote/applications/status-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Meeting } from "@/lib/calendar";
import { formatDateTime, formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CLOSED_STATUSES,
  stageColumns,
  stageMeeting,
  stageStatus,
  type ApplicationRow,
  type Stage,
} from "./shared";

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

/** "Today", "Tomorrow" or "Oct 12" in the display zone, with the time for a booked call. */
function stepDay(iso: string, withTime: boolean) {
  const day = formatDay(iso);
  const label =
    day === formatDay(new Date().toISOString())
      ? "Today"
      : day === formatDay(new Date(Date.now() + 86_400_000).toISOString())
        ? "Tomorrow"
        : formatDateTime(iso, "MMM d");
  return withTime ? `${label}, ${formatDateTime(iso, "HH:mm")}` : label;
}

/**
 * The date a step talks about: when it was decided, else its call, else (for
 * the first step) when you applied. A step still ahead only shows a call that
 * is booked.
 */
function stepWhen(stage: Stage, row: ApplicationRow): string | null {
  const booked = stage.meetings.find((meeting) => meeting.status === "scheduled");
  if (NOT_REACHED.has(stage.status)) return booked ? stepDay(booked.starts_at, true) : null;
  if (stage.decided_at) return stepDay(stage.decided_at, false);
  if (booked) return stepDay(booked.starts_at, true);
  const iso =
    stageMeeting(stage)?.starts_at ??
    stage.scheduled_for ??
    (stage.kind === "applied" ? row.applied_at : null);
  return iso ? stepDay(iso, stage.status === "scheduled") : null;
}

/**
 * The tracking table: one row per application, the interview steps as a run of
 * small marks in pipeline order (hover for the step, its status and date).
 *
 * Clicking a mark opens its menu - schedule, edit the booked call, or set the
 * status - the "..." button holds the application's own actions, and clicking
 * anywhere else on the row opens the application.
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
  /** The application open in the sheet, outlined in the accent. */
  activeId?: string | null;
  onOpen: (row: ApplicationRow) => void;
  onStatus: (row: ApplicationRow, status: string) => void;
  onStageStatus: (row: ApplicationRow, stage: Stage, status: string) => void;
  onSchedule: (row: ApplicationRow, stage: Stage) => void;
  onEditMeeting: (row: ApplicationRow, stage: Stage, meeting: Meeting) => void;
}) {
  const columns = useMemo(() => stageColumns(rows), [rows]);

  return (
    <Panel>
      <Table aria-label="Applications by interview step">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[34%]">Application</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead className="w-44">Steps</TableHead>
            <TableHead>Current step</TableHead>
            <TableHead className="w-28">Applied</TableHead>
            <TableHead className="w-14 text-right">Match</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const currentName = currentStageName(row, columns);
            const current = row.stages.find((stage) => stage.name === currentName);
            const closed = CLOSED_STATUSES.has(row.status);
            const byName = new Map(row.stages.map((stage) => [stage.name, stage]));
            return (
              <TableRow
                key={row.id}
                className={cn(
                  "cursor-pointer",
                  closed && "text-muted-foreground",
                  row.id === activeId && "bg-accent/60",
                )}
                onClick={() => onOpen(row)}
              >
                <TableCell className="w-full max-w-0 min-w-56 py-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <CompanyMark name={row.company_name} />
                    <button
                      type="button"
                      className="text-foreground max-w-[16rem] min-w-16 shrink-[2] truncate font-semibold outline-none focus-visible:underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(row);
                      }}
                    >
                      {row.company_name}
                    </button>
                    <span className="text-muted-foreground min-w-0 truncate text-xs">
                      {row.role_title}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="py-1" onClick={(event) => event.stopPropagation()}>
                  <StatusSelect
                    value={row.status}
                    onChange={(status) => onStatus(row, status)}
                    disabled={pending}
                    label={`Status for ${row.company_name}`}
                  />
                </TableCell>

                <TableCell className="py-1" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center gap-1" role="group" aria-label="Interview steps">
                    {columns.map((name) => {
                      const stage = byName.get(name);
                      if (!stage) {
                        return (
                          <span
                            key={name}
                            className="grid size-5 place-items-center"
                            title={`${name}: not part of this application`}
                          >
                            <span className="bg-foreground/15 size-1.5 rounded-full" />
                          </span>
                        );
                      }
                      const { label } = stageStatus(stage.status);
                      const when = stepWhen(stage, row);
                      const text = `${stage.name}: ${label}${when ? `, ${when}` : ""}`;
                      return (
                        <StageMenu
                          key={name}
                          stage={stage}
                          disabled={pending}
                          onStatus={(status) => onStageStatus(row, stage, status)}
                          onSchedule={() => onSchedule(row, stage)}
                          onEditMeeting={(meeting) => onEditMeeting(row, stage, meeting)}
                        >
                          <button
                            type="button"
                            title={text}
                            aria-label={text}
                            aria-current={name === currentName ? "step" : undefined}
                            className={cn(
                              "focus-visible:ring-ring/40 rounded-full outline-none hover:scale-110 focus-visible:ring-2",
                              name === currentName && "ring-foreground/40 ring-1 ring-offset-1 ring-offset-card",
                            )}
                          >
                            <StepMark status={stage.status} />
                          </button>
                        </StageMenu>
                      );
                    })}
                  </div>
                </TableCell>

                <TableCell className="w-44 max-w-44 py-1 text-xs">
                  {current && (
                    <span className="block truncate" title={current.name}>
                      <span className="text-foreground">{current.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {stageStatus(current.status).label.toLowerCase()}
                      </span>
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-muted-foreground py-1 text-xs">
                  {formatDistanceToNowStrict(new Date(row.applied_at ?? row.created_at), {
                    addSuffix: true,
                  })}
                  {!row.applied_at && " (saved)"}
                </TableCell>

                <TableCell className="py-1 text-right font-medium tabular-nums">
                  {row.must_have_coverage_percent != null
                    ? `${Math.round(row.must_have_coverage_percent)}%`
                    : <span className="text-subtle">-</span>}
                </TableCell>

                <TableCell className="py-1 text-right" onClick={(event) => event.stopPropagation()}>
                  <RowMenu row={row} onOpen={() => onOpen(row)} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-muted-foreground border-t px-3 py-1.5 text-xs tabular-nums">
        {rows.length} {rows.length === 1 ? "application" : "applications"}
      </p>
    </Panel>
  );
}

/** Open the application or its posting. */
function RowMenu({ row, onOpen }: { row: ApplicationRow; onOpen: () => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${row.company_name}`}
          className="text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted focus-visible:ring-ring/40 grid size-6 place-items-center rounded outline-none focus-visible:ring-2"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onOpen}>
          <PanelRightOpen />
          Open application
        </DropdownMenuItem>
        {row.job_url && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={row.job_url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open posting
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
