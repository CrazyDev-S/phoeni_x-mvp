"use client";

import { ArrowRight, Bookmark, CalendarClock, Clock } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";

import { StageSelect } from "@/components/freelancing/stage-select";
import { SectionHead } from "@/components/section-head";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <section className="bg-card/45 min-w-0 rounded-[30px] p-2.5">
      <header className="flex h-[46px] items-center gap-2.5 pr-1 pl-3">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", STAGE_DOT[stage])} />
        <h2 className="text-[0.97rem] font-bold tracking-tight">{STAGE_LABEL[stage]}</h2>
        <span className="bg-card grid h-[22px] min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold">
          {items.length}
        </span>
      </header>
      <div className="mt-1.5 flex flex-col gap-2.5">
        {items.map((track) => (
          <TrackCard key={track.id} track={track} selected={selected === track.id} onOpen={onOpen} />
        ))}
        {!items.length && (
          <div className="text-muted-foreground rounded-[22px] border-[1.5px] border-dashed border-foreground/15 px-4 py-7 text-center text-[0.8125rem] font-medium">
            No opportunities in this stage
          </div>
        )}
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
    <div className="space-y-7">
      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 min-[1400px]:mx-0 min-[1400px]:overflow-visible min-[1400px]:p-0">
        <div className="grid grid-flow-col auto-cols-[17.5rem] items-start gap-3.5 min-[1400px]:grid-flow-row min-[1400px]:auto-cols-auto min-[1400px]:grid-cols-5">
          {open.map((stage) => (
            <Column key={stage} stage={stage} items={byStage(stage)} selected={selectedTrack?.id} onOpen={onOpen} />
          ))}
        </div>
      </div>

      {showClosed && (
        <div className="space-y-3.5">
          <SectionHead
            title="Closed stages"
            count={`${closedCount} ${closedCount === 1 ? "opportunity" : "opportunities"}`}
          />
          <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 min-[1400px]:mx-0 min-[1400px]:overflow-visible min-[1400px]:p-0">
            <div className="grid grid-flow-col auto-cols-[17.5rem] items-start gap-3.5 min-[1400px]:grid-flow-row min-[1400px]:auto-cols-auto min-[1400px]:grid-cols-4">
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
  const skills = track.job.skills ?? [];
  const call = track.next_meeting;
  // The call you are about to take is the one card that should pull the eye.
  const hot = Boolean(call && isToday(call.starts_at));
  const proposal = track.proposal ? PROPOSAL_STATUS_LABEL[track.proposal.status] : null;
  const open = () => onOpen(track);
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <Card
      tone={hot ? "accent" : "default"}
      onClick={open}
      className={cn(
        "cursor-pointer gap-3 rounded-[24px] p-4 transition-shadow",
        selected && "ring-foreground/70 ring-2",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-[7px]">
          <span
            aria-hidden
            className="bg-success grid size-[22px] place-items-center rounded-[7px] text-[10.5px] font-extrabold text-white"
          >
            up
          </span>
          <span className={cn("text-[0.8125rem] font-medium", hot ? "text-brand-foreground/65" : "text-muted-foreground")}>
            Upwork
          </span>
        </div>
        <Bookmark aria-hidden className="size-[17px] fill-current" />
      </div>

      <h3 className="text-base leading-[1.22] font-semibold tracking-tight">
        <button
          type="button"
          onClick={(event) => {
            stop(event);
            open();
          }}
          className="focus-visible:ring-ring/40 -m-1 rounded-lg p-1 text-left outline-none focus-visible:ring-3"
        >
          {track.job.title}
        </button>
      </h3>

      <div>
        <div className="text-[0.9375rem] font-bold">{formatBudget(track.job)}</div>
        {track.job.client_country && (
          <div className={cn("text-[0.8125rem] font-medium", hot ? "text-brand-foreground/65" : "text-muted-foreground")}>
            {track.job.client_country}
          </div>
        )}
      </div>

      {skills.length > 0 && (
        <div className="flex flex-wrap gap-[5px]">
          {skills.slice(0, 2).map((skill) => (
            <Badge
              key={skill}
              variant="outline"
              className={cn("h-6 px-2.5", hot && "border-transparent bg-black/10 text-brand-foreground")}
            >
              {skill}
            </Badge>
          ))}
          {skills.length > 2 && (
            <Badge variant="secondary" className={cn("h-6", hot && "bg-black/10 text-brand-foreground")}>
              +{skills.length - 2}
            </Badge>
          )}
        </div>
      )}

      {(proposal || call) && (
        <div className="flex flex-wrap gap-[5px]">
          {proposal && (
            <StatusBadge tone={hot ? "neutral" : proposal.tone} className={cn("h-6", hot && "bg-primary text-primary-foreground")}>
              {proposal.label}
            </StatusBadge>
          )}
          {call && (
            <Badge variant={hot ? "secondary" : "info"} className={cn("h-6", hot && "bg-card text-card-foreground")}>
              <CalendarClock />
              {callLabel(call.starts_at)}
            </Badge>
          )}
        </div>
      )}

      <div className={cn("flex items-center gap-1.5 text-[0.8125rem] font-medium", hot ? "text-brand-foreground/65" : "text-muted-foreground")}>
        <Clock aria-hidden className="size-[13px]" />
        Updated {timeAgo(track.updated_at)}
      </div>

      {action.href ? (
        <Button
          asChild
          size="xs"
          variant={hot ? "secondary" : "outline"}
          className="h-9 w-full justify-between text-sm"
        >
          <Link href={action.href} onClick={stop}>
            {action.label}
            <ArrowRight />
          </Link>
        </Button>
      ) : (
        <Button
          type="button"
          size="xs"
          variant={hot ? "secondary" : "outline"}
          className="h-9 w-full justify-between text-sm"
          onClick={(event) => {
            stop(event);
            open();
          }}
        >
          {action.label}
          <ArrowRight />
        </Button>
      )}
    </Card>
  );
}

export function TrackTable({ rows, pending, onStage, onOpen }: { rows: Track[] } & TrackActions) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-64 px-6">Posting</TableHead>
            <TableHead className="min-w-44 px-4">Stage</TableHead>
            <TableHead className="px-4">Budget</TableHead>
            <TableHead className="px-4">Proposal</TableHead>
            <TableHead className="px-4">Next call</TableHead>
            <TableHead className="px-6 text-right">Updated</TableHead>
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
              <TableCell className="px-6 py-3.5">
                <span className="block max-w-80 truncate text-[0.9375rem] font-semibold">{track.job.title}</span>
                {track.job.client_country && (
                  <span className="text-muted-foreground block truncate text-xs font-medium">
                    {track.job.client_country}
                  </span>
                )}
              </TableCell>
              <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                <div className="w-44">
                  <StageSelect
                    value={track.stage}
                    disabled={pending}
                    label={`Stage for ${track.job.title}`}
                    className="h-9 rounded-full"
                    onChange={(stage) => onStage(track, stage)}
                  />
                </div>
              </TableCell>
              <TableCell className="px-4 text-sm font-bold whitespace-nowrap">{formatBudget(track.job)}</TableCell>
              <TableCell className="px-4">
                {track.proposal ? (
                  <StatusBadge tone={PROPOSAL_STATUS_LABEL[track.proposal.status].tone}>
                    {PROPOSAL_STATUS_LABEL[track.proposal.status].label}
                  </StatusBadge>
                ) : (
                  <span className="text-subtle text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="px-4">
                {track.next_meeting ? (
                  <Badge variant={isToday(track.next_meeting.starts_at) ? "brand" : "info"} className="h-6">
                    <CalendarClock />
                    {callLabel(track.next_meeting.starts_at)}
                  </Badge>
                ) : (
                  <span className="text-subtle text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground px-6 text-right text-xs font-medium whitespace-nowrap">
                {timeAgo(track.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
