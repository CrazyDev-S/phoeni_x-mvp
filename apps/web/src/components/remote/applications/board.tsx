"use client";

import { CalendarClock, ExternalLink } from "lucide-react";

import { StatusSelect } from "@/components/remote/applications/status-select";
import { CompanyMark } from "@/components/remote/applications/step-mark";
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
    <div className="-mx-3 overflow-x-auto px-3 pb-2 md:-mx-4 md:px-4">
      <div className="flex min-w-max items-start gap-2">
        {STATUSES.map((status) => {
          const items = rows.filter((r) => r.status === status);
          return (
            <section key={status} className="bg-muted/60 w-64 shrink-0 rounded-lg border p-1.5">
              <header className="flex items-center gap-2 px-1.5 pb-1.5">
                <h2 className="text-[13px] font-semibold">{STATUS_LABEL[status]}</h2>
                <span className="text-muted-foreground text-[11px] font-semibold tabular-nums">
                  {items.length}
                </span>
              </header>

              <div className="space-y-1.5">
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
                  <p className="text-subtle px-2 py-3 text-center text-xs">Nothing here</p>
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

  return (
    <article className="bg-card hover:border-foreground/25 space-y-1 rounded-md border p-1.5 transition-colors">
      <div className="flex items-center gap-1.5">
        <CompanyMark name={row.company_name} />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left leading-tight">
          <p className="truncate text-[13px] font-semibold hover:underline">{row.company_name}</p>
          <p className="text-muted-foreground truncate text-[11px]">{row.role_title}</p>
        </button>
        {row.job_url && (
          <a
            href={row.job_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open the ${row.company_name} posting`}
            className="text-subtle hover:text-foreground shrink-0"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate">
          {row.current_stage?.name ?? "No open step"}{" "}
          <span className="tabular-nums">
            {row.stages_passed}/{row.stage_count}
          </span>
        </span>
        {row.next_meeting && (
          <span className={cn("flex shrink-0 items-center gap-1", soon && "text-foreground font-medium")}>
            <CalendarClock className="size-3" />
            {formatDateTime(row.next_meeting.starts_at, "d MMM HH:mm")}
          </span>
        )}
        {row.must_have_coverage_percent != null && (
          <span className="text-foreground shrink-0 font-semibold tabular-nums">
            {Math.round(row.must_have_coverage_percent)}%
          </span>
        )}
      </div>

      <StatusSelect
        value={row.status}
        onChange={onStatus}
        disabled={pending}
        label={`Status for ${row.company_name}`}
      />
    </article>
  );
}
