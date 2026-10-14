"use client";

import { CalendarClock, ExternalLink } from "lucide-react";

import { StatusSelect } from "@/components/remote/applications/status-select";
import { CompanyMark } from "@/components/remote/applications/step-mark";
import { Progress } from "@/components/ui/progress";
import { formatDateTime, IMMINENT_MINUTES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUSES, type ApplicationRow } from "./shared";

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
      <div className="flex min-w-max items-start gap-4">
        {STATUSES.map((status) => {
          const items = rows.filter((r) => r.status === status);
          return (
            <section key={status} className="bg-soft w-72 shrink-0 rounded-[1.75rem] p-3">
              <header className="mb-3 flex items-center gap-2.5 px-2 pt-1.5">
                <h2 className="text-[1.0625rem] font-semibold">{STATUS_LABEL[status]}</h2>
                <span className="text-muted-foreground border-foreground border-b-[1.5px] pb-px text-[0.8125rem] font-semibold tabular-nums">
                  {items.length}
                </span>
              </header>

              <div className="space-y-2.5">
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
                  <p className="text-subtle px-3 py-6 text-center text-xs font-medium">
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
  const soon = row.next_meeting && minutesUntil(row.next_meeting.starts_at) <= IMMINENT_MINUTES;
  const progress = row.stage_count ? (row.stages_passed / row.stage_count) * 100 : 0;

  return (
    <article className="bg-card shadow-card rounded-3xl p-4 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        <CompanyMark name={row.company_name} className="size-9 rounded-xl text-sm" />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[0.9375rem] leading-tight font-bold hover:underline">
            {row.company_name}
          </p>
          <p className="text-muted-foreground mt-px truncate text-[0.78rem] font-medium">
            {row.role_title}
          </p>
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

      <div className="mt-3.5 space-y-1.5">
        <div className="text-muted-foreground flex items-center justify-between text-xs font-semibold">
          <span>{row.current_stage?.name ?? "No open step"}</span>
          <span className="tabular-nums">
            {row.stages_passed}/{row.stage_count}
          </span>
        </div>
        <Progress value={progress} className="h-1.5" aria-label="Steps passed" />
      </div>

      {row.next_meeting && (
        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-xs font-semibold",
            soon ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <CalendarClock className="size-3.5 shrink-0" />
          {formatDateTime(row.next_meeting.starts_at, "d MMM HH:mm")}
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <StatusSelect
            value={row.status}
            onChange={onStatus}
            disabled={pending}
            label={`Status for ${row.company_name}`}
          />
        </div>
        {row.must_have_coverage_percent != null && (
          <span className="text-[0.84rem] font-bold tabular-nums">
            {Math.round(row.must_have_coverage_percent)}%
          </span>
        )}
      </div>
    </article>
  );
}
