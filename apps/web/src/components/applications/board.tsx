"use client";

import { CalendarClock, ExternalLink } from "lucide-react";

import { StatusSelect } from "@/components/applications/status-select";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDateTime, IMMINENT_MINUTES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, STATUSES, type ApplicationRow } from "./shared";

function minutesUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 60_000;
}

/**
 * The board.
 *
 * Cards move between columns through the select on the card rather than by
 * dragging: the same gesture then works on a phone and from the keyboard,
 * which a drag target does not.
 */
export function ApplicationBoard({
  rows,
  onStatus,
  onOpen,
  pending,
}: {
  rows: ApplicationRow[];
  onStatus: (id: string, status: string) => void;
  onOpen: (row: ApplicationRow) => void;
  pending: boolean;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
      <div className="flex min-w-max gap-4">
        {STATUSES.map((status) => {
          const items = rows.filter((r) => r.status === status);
          return (
            <section key={status} className="w-72 shrink-0">
              <header className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold">{STATUS_LABEL[status]}</h2>
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
                  {items.length}
                </span>
              </header>

              <div className="space-y-3">
                {items.map((row) => (
                  <BoardCard
                    key={row.id}
                    row={row}
                    pending={pending}
                    onStatus={(next) => onStatus(row.id, next)}
                    onOpen={() => onOpen(row)}
                  />
                ))}
                {!items.length && (
                  <p className="text-subtle rounded-xl border border-dashed px-3 py-6 text-center text-xs">
                    Nothing here
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({
  row,
  onStatus,
  onOpen,
  pending,
}: {
  row: ApplicationRow;
  onStatus: (next: string) => void;
  onOpen: () => void;
  pending: boolean;
}) {
  const soon =
    row.next_meeting && minutesUntil(row.next_meeting.starts_at) <= IMMINENT_MINUTES;
  const progress = row.stage_count ? (row.stages_passed / row.stage_count) * 100 : 0;

  return (
    <Card className="gap-0 p-4 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold hover:underline">{row.company_name}</p>
          <p className="text-muted-foreground truncate text-xs">{row.role_title}</p>
        </button>
        {row.job_url && (
          <a
            href={row.job_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open the ${row.company_name} posting`}
            className="text-subtle hover:text-foreground shrink-0 transition-colors"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="text-subtle flex items-center justify-between text-xs">
          <span>{row.current_stage?.name ?? "No open step"}</span>
          <span className="tabular-nums">
            {row.stages_passed}/{row.stage_count}
          </span>
        </div>
        <Progress value={progress} className="h-1" aria-label="Steps passed" />
      </div>

      {row.next_meeting && (
        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-xs",
            soon ? "text-primary font-medium" : "text-muted-foreground",
          )}
        >
          <CalendarClock className="size-3.5 shrink-0" />
          {formatDateTime(row.next_meeting.starts_at, "d MMM HH:mm")}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <StatusSelect
            value={row.status}
            onChange={onStatus}
            disabled={pending}
            label={`Status for ${row.company_name}`}
          />
        </div>
        {row.must_have_coverage_percent != null && (
          <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>
            {Math.round(row.must_have_coverage_percent)}%
          </StatusBadge>
        )}
      </div>
    </Card>
  );
}
