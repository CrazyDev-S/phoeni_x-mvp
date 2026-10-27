"use client";

import { ArrowRight, CalendarClock } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";

import { StageSelect } from "@/components/freelancing/stage-select";
import { Panel } from "@/components/panel";
import { SectionHead } from "@/components/section-head";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatDay } from "@/lib/format";
import {
  CLOSED_STAGES,
  formatBudget,
  PROPOSAL_STATUS_LABEL,
  STAGE_LABEL,
  STAGES,
  timeAgo,
  type Track,
  type TrackStage,
} from "@/lib/freelancing";
import { cn } from "@/lib/utils";

export interface TrackActions {
  pending: boolean;
  onStage: (track: Track, stage: TrackStage) => void;
  onOpen: (track: Track) => void;
}

/** The dot beside a column's name: grey while it is still yours, accent once it is out, then the outcome. */
const STAGE_DOT: Record<TrackStage, string> = {
  focused: "bg-subtle",
  proposal_drafted: "bg-subtle",
  submitted: "bg-brand",
  viewed: "bg-brand",
  interviewing: "bg-info",
  hired: "bg-success",
  declined: "bg-destructive",
  withdrawn: "bg-subtle",
  closed: "bg-subtle",
};

/**
 * What a card's button does. Where the stage has a real destination (the
 * proposal editor, or the dialog that drafts one) it goes there; otherwise it
 * opens the track.
 */
function cardAction(track: Track): { label: string; href?: string } {
  const proposal = track.proposal ? `/freelancing/proposals/${track.proposal.id}` : undefined;
  switch (track.stage) {
    case "focused":
      return { label: "Move to drafting", href: `/freelancing/proposals?job=${track.job_id}` };
    case "proposal_drafted":
      return { label: "Continue drafting", href: proposal };
    case "submitted":
      return { label: "View proposal", href: proposal };
    case "viewed":
      return { label: "Follow up" };
    case "interviewing":
      return { label: "View details" };
    case "hired":
      return { label: "View contract" };
    default:
      return { label: "View feedback" };
  }
}

/** "Today, 3:00 pm" or "12 Oct, 3:00 pm". */
function callLabel(startsAt: string): string {
  const today = formatDay(startsAt) === formatDay(new Date().toISOString());
  const time = formatDateTime(startsAt, "h:mm aaa");
  return today ? `Today, ${time}` : `${formatDateTime(startsAt, "d MMM")}, ${time}`;
}

function isToday(iso: string): boolean {
  return formatDay(iso) === formatDay(new Date().toISOString());
}

function Column({
  stage,
  items,
  selected,
  onOpen,
}: {
  stage: TrackStage;
  items: Track[];
  selected?: string | null;
  onOpen: (track: Track) => void;
}) {
  return (
    <section className="bg-muted/60 min-w-0 rounded-lg border p-1.5">
      <header className="flex h-7 items-center gap-2 px-1.5">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[stage])} />
        <h2 className="text-xs font-semibold">{STAGE_LABEL[stage]}</h2>
        <span className="text-muted-foreground text-[11px] font-semibold tabular-nums">{items.length}</span>
      </header>
      <div className="mt-1 flex flex-col gap-1">
        {items.map((track) => (
          <TrackCard key={track.id} track={track} selected={selected === track.id} onOpen={onOpen} />
        ))}
        {!items.length && <p className="text-subtle px-1.5 py-2 text-center text-xs">Empty</p>}
      </div>
    </section>
  );
}

export function TrackBoard({
  rows,
  showClosed,
  selectedTrack,
  onOpen,
}: {
  rows: Track[];
  showClosed: boolean;
  selectedTrack?: Track | null;
  onOpen: (track: Track) => void;
}) {
  const open = STAGES.filter((s) => !CLOSED_STAGES.has(s));
  const closed = STAGES.filter((s) => CLOSED_STAGES.has(s));
  const byStage = (stage: TrackStage) => rows.filter((r) => r.stage === stage);
  const closedCount = rows.filter((r) => CLOSED_STAGES.has(r.stage)).length;

  return (
    <div className="space-y-3">
      <div className="-mx-3 overflow-x-auto px-3 pb-1 md:-mx-4 md:px-4 min-[1200px]:mx-0 min-[1200px]:overflow-visible min-[1200px]:p-0">
        <div className="grid grid-flow-col auto-cols-[15rem] items-start gap-2 min-[1200px]:grid-flow-row min-[1200px]:auto-cols-auto min-[1200px]:grid-cols-5">
          {open.map((stage) => (
            <Column key={stage} stage={stage} items={byStage(stage)} selected={selectedTrack?.id} onOpen={onOpen} />
          ))}
        </div>
      </div>

      {showClosed && (
        <div className="space-y-2">
          <SectionHead title="Closed stages" count={closedCount} />
          <div className="-mx-3 overflow-x-auto px-3 pb-1 md:-mx-4 md:px-4 min-[1200px]:mx-0 min-[1200px]:overflow-visible min-[1200px]:p-0">
            <div className="grid grid-flow-col auto-cols-[15rem] items-start gap-2 min-[1200px]:grid-flow-row min-[1200px]:auto-cols-auto min-[1200px]:grid-cols-4">
              {closed.map((stage) => (
                <Column key={stage} stage={stage} items={byStage(stage)} selected={selectedTrack?.id} onOpen={onOpen} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One opportunity on the board: title, the facts on one line, and the stage's next step. */
function TrackCard({
  track,
  selected,
  onOpen,
}: {
  track: Track;
  selected?: boolean;
  onOpen: (track: Track) => void;
}) {
  const action = cardAction(track);
  const call = track.next_meeting;
  // The call you are about to take is the one card that should pull the eye.
  const hot = Boolean(call && isToday(call.starts_at));
  const proposal = track.proposal ? PROPOSAL_STATUS_LABEL[track.proposal.status] : null;
  const open = () => onOpen(track);
  const stop = (event: MouseEvent) => event.stopPropagation();
  const facts = [formatBudget(track.job), track.job.client_country, timeAgo(track.updated_at)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      onClick={open}
      className={cn(
        "bg-card cursor-pointer rounded-md border px-2 py-1.5 transition-colors hover:border-foreground/30",
        hot && "border-brand shadow-[inset_2px_0_0_var(--brand)]",
        selected && "ring-foreground/60 ring-2",
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={(event) => {
            stop(event);
            open();
          }}
          className="focus-visible:ring-ring/40 min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium outline-none focus-visible:ring-2"
          title={track.job.title}
        >
          {track.job.title}
        </button>
        {action.href ? (
          <Link
            href={action.href}
            onClick={stop}
            title={action.label}
            aria-label={action.label}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <ArrowRight className="size-3.5" />
          </Link>
        ) : (
          <button
            type="button"
            title={action.label}
            aria-label={action.label}
            onClick={(event) => {
              stop(event);
              open();
            }}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
      <p className="text-muted-foreground truncate text-xs">{facts}</p>
      {(proposal || call) && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {proposal && <StatusBadge tone={proposal.tone}>{proposal.label}</StatusBadge>}
          {call && (
            <Badge variant={hot ? "brand" : "info"}>
              <CalendarClock />
              {callLabel(call.starts_at)}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export function TrackTable({ rows, pending, onStage, onOpen }: { rows: Track[] } & TrackActions) {
  return (
    <Panel>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Posting</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Budget</TableHead>
            <TableHead>Proposal</TableHead>
            <TableHead>Next call</TableHead>
            <TableHead className="text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((track) => (
            <TableRow
              key={track.id}
              tabIndex={0}
              aria-label={track.job.title}
              className="cursor-pointer"
              onClick={() => onOpen(track)}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && event.key === "Enter") onOpen(track);
              }}
            >
              <TableCell className="w-full max-w-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-medium" title={track.job.title}>
                    {track.job.title}
                  </span>
                  {track.job.client_country && (
                    <span className="text-muted-foreground shrink-0 text-xs">{track.job.client_country}</span>
                  )}
                </div>
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="w-40">
                  <StageSelect
                    value={track.stage}
                    disabled={pending}
                    label={`Stage for ${track.job.title}`}
                    className="h-7"
                    onChange={(stage) => onStage(track, stage)}
                  />
                </div>
              </TableCell>
              <TableCell className="font-medium">{formatBudget(track.job)}</TableCell>
              <TableCell>
                {track.proposal ? (
                  <StatusBadge tone={PROPOSAL_STATUS_LABEL[track.proposal.status].tone}>
                    {PROPOSAL_STATUS_LABEL[track.proposal.status].label}
                  </StatusBadge>
                ) : (
                  <span className="text-subtle text-xs">-</span>
                )}
              </TableCell>
              <TableCell>
                {track.next_meeting ? (
                  <Badge variant={isToday(track.next_meeting.starts_at) ? "brand" : "info"}>
                    <CalendarClock />
                    {callLabel(track.next_meeting.starts_at)}
                  </Badge>
                ) : (
                  <span className="text-subtle text-xs">-</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-right text-xs">{timeAgo(track.updated_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
