"use client";

import {
  ArrowRight,
  Bookmark,
  Calendar,
  CalendarClock,
  CalendarPlus,
  Clock,
  ExternalLink,
  Eye,
  FileSignature,
  FileText,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trophy,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { StageSelect } from "@/components/freelancing/stage-select";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, IMMINENT_MINUTES } from "@/lib/format";
import {
  CLOSED_STAGES,
  formatBudget,
  PROPOSAL_STATUS_LABEL,
  STAGE_LABEL,
  STAGES,
  STAGE_TONE,
  timeAgo,
  type Track,
  type TrackStage,
} from "@/lib/freelancing";
import { cn } from "@/lib/utils";

function minutesUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 60_000;
}

export interface TrackActions {
  pending: boolean;
  onStage: (track: Track, stage: TrackStage) => void;
  onOpen: (track: Track) => void;
  onSchedule: (track: Track) => void;
}

function getPlatformPill(platform = "Upwork") {
  switch (platform.toLowerCase()) {
    case "freelancer":
      return { label: "Freelancer", bg: "bg-blue-600 text-white" };
    case "toptal":
      return { label: "Toptal", bg: "bg-slate-700 text-white" };
    case "fiverr":
      return { label: "Fiverr", bg: "bg-emerald-600 text-white" };
    case "peopleperhour":
      return { label: "PeoplePerHour", bg: "bg-orange-600 text-white" };
    default:
      return { label: "Upwork", bg: "bg-emerald-600 text-white" };
  }
}

function getCardAction(stage: TrackStage): { label: string; href?: string } {
  switch (stage) {
    case "focused":
      return { label: "Move to Drafting" };
    case "proposal_drafted":
      return { label: "Continue Drafting" };
    case "submitted":
      return { label: "View Proposal" };
    case "viewed":
      return { label: "Follow Up" };
    case "interviewing":
      return { label: "View Details" };
    case "hired":
      return { label: "View Contract" };
    default:
      return { label: "View Feedback" };
  }
}

export function TrackBoard({
  rows,
  showClosed,
  selectedTrack,
  ...actions
}: { rows: Track[]; showClosed: boolean; selectedTrack?: Track | null } & TrackActions) {
  const columns = STAGES.filter((s) => showClosed || !CLOSED_STAGES.has(s));

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
      <div className="flex min-w-max gap-4">
        {columns.map((stage) => {
          const items = rows.filter((r) => r.stage === stage);
          return (
            <section key={stage} className="w-80 shrink-0">
              <header className="mb-3 flex items-center justify-between rounded-xl bg-stone-100/80 dark:bg-stone-800/80 px-3.5 py-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    {STAGE_LABEL[stage]}
                  </h2>
                  <span className="rounded-full bg-stone-200 dark:bg-stone-700 px-2 py-0.2 text-[11px] font-bold text-stone-700 dark:text-stone-300">
                    {items.length}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-md text-stone-400 hover:text-stone-700"
                >
                  <Plus className="size-3.5" />
                </Button>
              </header>

              <div className="space-y-3">
                {items.map((track) => (
                  <KanbanCard
                    key={track.id}
                    track={track}
                    isSelected={selectedTrack?.id === track.id}
                    {...actions}
                  />
                ))}
                {!items.length && (
                  <div className="rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 p-6 text-center text-xs text-stone-400">
                    No opportunities in this stage
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KanbanCard({
  track,
  isSelected,
  pending,
  onStage,
  onOpen,
  onSchedule,
}: { track: Track; isSelected?: boolean } & TrackActions) {
  const platform = getPlatformPill(track.job.client_country ? "Upwork" : "Upwork");
  const action = getCardAction(track.stage);
  const budget = formatBudget(track.job);

  // Hash-based deterministic match score for mockup fidelity
  let hash = 0;
  for (let i = 0; i < track.id.length; i++) hash = (hash << 5) - hash + track.id.charCodeAt(i);
  const matchScore = 80 + (Math.abs(hash) % 19);

  return (
    <Card
      onClick={() => onOpen(track)}
      className={cn(
        "group cursor-pointer rounded-2xl border bg-white dark:bg-stone-900 p-4 transition-all duration-200 hover:shadow-md",
        isSelected
          ? "border-orange-500 ring-1 ring-orange-500/30 shadow-md"
          : "border-stone-200/80 dark:border-stone-800 hover:border-orange-300 dark:hover:border-orange-900/60",
      )}
    >
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-sm text-stone-900 dark:text-stone-100 line-clamp-2 hover:text-orange-600 transition-colors">
            {track.job.title}
          </h3>
          <Bookmark className="size-4 text-orange-500 fill-orange-500 shrink-0" />
        </div>

        {/* Platform badge + match badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="flex size-5 items-center justify-center rounded-md bg-emerald-600 text-[10px] font-black text-white">
              up
            </span>
            <span className="text-xs text-stone-600 dark:text-stone-400 font-medium">Upwork</span>
          </div>

          <div className="flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
            <span>{matchScore}%</span>
          </div>
        </div>

        {/* Budget */}
        <div className="text-xs font-bold text-stone-900 dark:text-stone-100">{budget}</div>

        {/* Tags */}
        {track.job.skills && track.job.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {track.job.skills.slice(0, 3).map((skill) => (
              <span
                key={skill}
                className="rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-300"
              >
                {skill}
              </span>
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div className="flex items-center gap-1 text-[11px] text-stone-400 pt-1">
          <Clock className="size-3" />
          <span>Updated {timeAgo(track.updated_at)}</span>
        </div>

        {/* Action Button */}
        <div className="pt-2 border-t border-stone-100 dark:border-stone-800">
          <Button
            size="sm"
            className="w-full h-8 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:hover:bg-orange-950 dark:text-orange-300 border border-orange-200/80 dark:border-orange-800 text-xs font-semibold gap-1"
          >
            <span>{action.label}</span>
            <ArrowRight className="size-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function TrackTable({
  rows,
  pending,
  onStage,
  onOpen,
  onSchedule,
}: { rows: Track[] } & TrackActions) {
  return (
    <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 overflow-hidden py-0 shadow-xs">
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-stone-200 dark:border-stone-800">
              <TableHead className="min-w-64 px-5">Posting</TableHead>
              <TableHead className="min-w-44 px-4">Stage</TableHead>
              <TableHead className="px-4">Budget</TableHead>
              <TableHead className="px-4">Proposal</TableHead>
              <TableHead className="px-4">Next Call</TableHead>
              <TableHead className="px-4 text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((track) => {
              const soon =
                track.next_meeting &&
                minutesUntil(track.next_meeting.starts_at) <= IMMINENT_MINUTES;
              return (
                <TableRow
                  key={track.id}
                  className="cursor-pointer hover:bg-stone-50/70 dark:hover:bg-stone-900/50"
                  onClick={() => onOpen(track)}
                >
                  <TableCell className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="block max-w-72 truncate font-bold text-sm text-stone-900 dark:text-stone-100">
                          {track.job.title}
                        </span>
                        <span className="text-stone-500 block truncate text-xs">
                          {formatBudget(track.job)}
                          {track.job.client_country ? ` · ${track.job.client_country}` : ""}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                    <div className="w-44">
                      <StageSelect
                        value={track.stage}
                        disabled={pending}
                        label={`Stage for ${track.job.title}`}
                        onChange={(stage) => onStage(track, stage)}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-xs font-semibold">
                    {formatBudget(track.job)}
                  </TableCell>
                  <TableCell className="px-4">
                    {track.proposal ? (
                      <StatusBadge
                        tone={PROPOSAL_STATUS_LABEL[track.proposal.status].tone}
                        className="text-[10px]"
                      >
                        {PROPOSAL_STATUS_LABEL[track.proposal.status].label}
                      </StatusBadge>
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 text-xs">
                    {track.next_meeting ? (
                      <span className="font-semibold text-orange-600">
                        {formatDateTime(track.next_meeting.starts_at, "d MMM HH:mm")}
                      </span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 text-right text-xs text-stone-400">
                    {timeAgo(track.updated_at)}
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
