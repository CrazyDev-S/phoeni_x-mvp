"use client";

import { ExternalLink } from "lucide-react";
import { useMemo } from "react";

import { StageMenu } from "@/components/applications/stage-menu";
import { StatusSelect } from "@/components/applications/status-select";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Meeting } from "@/lib/calendar";
import { formatDateTime, IMMINENT_MINUTES } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  STATUS_TONE,
  stageColumns,
  stageMeeting,
  stageStatus,
  TONE_TINT,
  type ApplicationRow,
  type Stage,
} from "./shared";

// The row hover is a translucent tint; the sticky column has to paint the
// same colour opaquely or the scrolled cells show through it.
const STICKY_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";

/**
 * The tracking table: one row per application, one column per interview step.
 *
 * A cell is that step's status. Clicking it opens the step's menu — schedule,
 * edit the booked call, or set the status — and clicking anywhere else on the
 * row opens the application.
 */
export function PipelineTable({
  rows,
  pending,
  onOpen,
  onStatus,
  onStageStatus,
  onSchedule,
  onEditMeeting,
}: {
  rows: ApplicationRow[];
  pending: boolean;
  onOpen: (row: ApplicationRow) => void;
  onStatus: (row: ApplicationRow, status: string) => void;
  onStageStatus: (row: ApplicationRow, stage: Stage, status: string) => void;
  onSchedule: (row: ApplicationRow, stage: Stage) => void;
  onEditMeeting: (row: ApplicationRow, stage: Stage, meeting: Meeting) => void;
}) {
  const columns = useMemo(() => stageColumns(rows), [rows]);

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="px-0">
        <Table className="border-separate border-spacing-0">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="bg-card sticky left-0 z-20 min-w-60 border-r border-b px-4">
                Application
              </TableHead>
              <TableHead className="min-w-40 border-b px-3">Status</TableHead>
              {columns.map((name, index) => (
                <TableHead
                  key={name}
                  className="h-auto max-w-36 min-w-32 border-b px-2 py-2.5 align-bottom text-xs leading-tight whitespace-normal"
                >
                  <span className="text-subtle mr-1 tabular-nums">{index + 1}</span>
                  {name}
                </TableHead>
              ))}
              <TableHead className="border-b px-4 text-right">Match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child_td]:border-b-0">
            {rows.map((row) => {
              const byName = new Map(row.stages.map((stage) => [stage.name, stage]));
              return (
                <TableRow
                  key={row.id}
                  className="group cursor-pointer"
                  onClick={() => onOpen(row)}
                >
                  <TableCell
                    className={cn(
                      "bg-card sticky left-0 z-10 border-r border-b px-4 py-2.5 transition-colors",
                      STICKY_HOVER,
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left outline-none focus-visible:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(row);
                        }}
                      >
                        <span className="block max-w-52 truncate font-medium">
                          {row.company_name}
                        </span>
                        <span className="text-muted-foreground block max-w-52 truncate text-xs">
                          {row.role_title}
                        </span>
                      </button>
                      {row.job_url && (
                        <a
                          href={row.job_url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open the ${row.company_name} posting`}
                          className="text-subtle hover:text-foreground shrink-0 p-1 transition-colors"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>

                  <TableCell
                    className="border-b px-3"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="w-36">
                      <StatusSelect
                        value={row.status}
                        disabled={pending}
                        label={`Status for ${row.company_name}`}
                        onChange={(status) => onStatus(row, status)}
                      />
                    </div>
                  </TableCell>

                  {columns.map((name) => {
                    const stage = byName.get(name);
                    return (
                      <TableCell
                        key={name}
                        className="border-b px-1.5 py-1.5"
                        // Menu items render in a portal, but React still bubbles
                        // their clicks through here; stop them opening the row.
                        onClick={(event) => event.stopPropagation()}
                      >
                        {stage ? (
                          <StageMenu
                            stage={stage}
                            disabled={pending}
                            onStatus={(status) => onStageStatus(row, stage, status)}
                            onSchedule={() => onSchedule(row, stage)}
                            onEditMeeting={(meeting) => onEditMeeting(row, stage, meeting)}
                          >
                            <StageCell stage={stage} />
                          </StageMenu>
                        ) : (
                          <span className="text-subtle block px-2 text-xs">—</span>
                        )}
                      </TableCell>
                    );
                  })}

                  <TableCell className="border-b px-4 text-right">
                    {row.must_have_coverage_percent != null ? (
                      <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>
                        {Math.round(row.must_have_coverage_percent)}%
                      </StatusBadge>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StageCell({ stage, ...props }: { stage: Stage } & React.ComponentProps<"button">) {
  const { label, tone, Icon } = stageStatus(stage.status);
  const meeting = stageMeeting(stage);
  const when =
    meeting && meeting.status !== "cancelled" ? meeting.starts_at : stage.scheduled_for;
  const minutesAway = meeting ? (new Date(meeting.starts_at).getTime() - Date.now()) / 60_000 : 0;
  const soon = meeting?.status === "scheduled" && minutesAway >= 0 && minutesAway <= IMMINENT_MINUTES;

  return (
    <button
      type="button"
      aria-label={`${stage.name}: ${label}`}
      className={cn(
        "hover:ring-border focus-visible:ring-ring flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-shadow outline-none hover:ring-1 focus-visible:ring-2 aria-expanded:ring-1",
        TONE_TINT[tone],
        stage.status === "pending" && "text-subtle",
      )}
      {...props}
    >
      <span className="flex items-center gap-1 font-medium whitespace-nowrap">
        <Icon className="size-3.5 shrink-0" />
        {label}
      </span>
      {when && (
        <span className={cn("tabular-nums", soon ? "font-semibold" : "opacity-80")}>
          {formatDateTime(when, "d MMM, HH:mm")}
        </span>
      )}
    </button>
  );
}
