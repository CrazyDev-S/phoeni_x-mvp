"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, EyeOff, Star, Users } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { request } from "@/lib/api";
import {
  clientSummary,
  formatBudget,
  humanizeEnum,
  invalidateFreelancing,
  STAGE_LABEL,
  STAGE_TONE,
  timeAgo,
  type JobCard as JobCardData,
} from "@/lib/freelancing";
import { cn } from "@/lib/utils";

const EXCERPT = 280;

/**
 * The star. Focus is the first stage of the tracker, so this is where tracking
 * starts. A round icon button on a card; a labelled pill on the posting's page.
 */
export function FocusButton({
  job,
  onChange,
  variant = "icon",
}: {
  job: Pick<JobCardData, "id" | "focused_at" | "title">;
  onChange?: (next: JobCardData) => void;
  variant?: "icon" | "pill";
}) {
  const queryClient = useQueryClient();
  const focused = job.focused_at !== null;
  const toggle = useMutation({
    mutationFn: () =>
      request<JobCardData>(`/api/v1/freelancing/jobs/${job.id}/focus`, {
        method: focused ? "DELETE" : "POST",
      }),
    onSuccess: (next) => {
      onChange?.(next);
      invalidateFreelancing(queryClient);
    },
  });
  const press = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    toggle.mutate();
  };
  const label = focused ? `Unfocus ${job.title}` : `Focus ${job.title}`;

  if (variant === "pill") {
    return (
      <Button
        type="button"
        variant="secondary"
        size="lg"
        aria-pressed={focused}
        aria-label={label}
        disabled={toggle.isPending}
        onClick={press}
      >
        <Star className={cn("text-warning", focused && "fill-current")} />
        {focused ? "Focused" : "Focus"}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconAction
          aria-pressed={focused}
          aria-label={label}
          disabled={toggle.isPending}
          onClick={press}
          className={cn(focused && "bg-warning/18 text-warning hover:bg-warning/25 hover:text-warning")}
        >
          <Star className={cn(focused && "fill-current")} />
        </IconAction>
      </TooltipTrigger>
      <TooltipContent>{focused ? "Focused - in your tracker" : "Focus this job"}</TooltipContent>
    </Tooltip>
  );
}

/** A round soft button for the row of actions on a result. */
function IconAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className={cn(
        "bg-soft text-muted-foreground hover:bg-soft-2 hover:text-foreground size-[38px] [&_svg:not([class*='size-'])]:size-[17px]",
        className,
      )}
      {...props}
    />
  );
}

/** A meta chip: one fact about the posting. */
function MetaChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "bg-soft text-foreground/70 inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The facts about a posting as chips. On the posting's own page the budget,
 * duration, workload and connects are shown large beside it, so `detail`
 * leaves them out here.
 */
export function JobMetaChips({ job, detail }: { job: JobCardData; detail?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!detail && <MetaChip className="bg-brand text-brand-foreground font-bold">{formatBudget(job)}</MetaChip>}
      {job.experience_level && <MetaChip>{humanizeEnum(job.experience_level)}</MetaChip>}
      {!detail && job.duration_label && <MetaChip>{job.duration_label}</MetaChip>}
      {!detail && job.workload && <MetaChip>{job.workload}</MetaChip>}
      {job.total_applicants != null && (
        <MetaChip>
          <Users className="size-3.5" />
          {job.total_applicants} proposals
        </MetaChip>
      )}
      {!detail && job.connects_required != null && <MetaChip>{job.connects_required} connects</MetaChip>}
      {job.featured && <MetaChip className="bg-warning/18 text-warning">Featured</MetaChip>}
      {job.job_score != null && <MetaChip>Score {job.job_score.toFixed(1)}</MetaChip>}
      {job.is_premium && <MetaChip className="bg-warning/18 text-warning">Premium</MetaChip>}
      {job.is_enterprise && <MetaChip className="bg-info/15 text-info">Enterprise</MetaChip>}
      {job.applied && <MetaChip className="bg-success/15 text-success">Applied</MetaChip>}
    </div>
  );
}

/**
 * One search result.
 *
 * The whole card links to the posting's page here; the star, the hide button
 * and the Upwork link are separate targets that stop the click.
 */
export function JobCard({
  job,
  onChange,
  onHidden,
}: {
  job: JobCardData;
  onChange?: (next: JobCardData) => void;
  onHidden?: (job: JobCardData) => void;
}) {
  const queryClient = useQueryClient();
  const hide = useMutation({
    mutationFn: () =>
      request<JobCardData>(`/api/v1/freelancing/jobs/${job.id}/hide`, {
        method: job.hidden_at ? "DELETE" : "POST",
      }),
    onSuccess: (next) => {
      if (next.hidden_at) onHidden?.(next);
      onChange?.(next);
      invalidateFreelancing(queryClient);
    },
  });

  const excerpt =
    job.description && job.description.length > EXCERPT
      ? job.description.slice(0, EXCERPT).replace(/\s+\S*$/, "") + "…"
      : (job.description ?? "");
  const client = clientSummary(job.client);

  return (
    <Card
      className={cn(
        "gap-0 rounded-[30px] px-5 pt-5 pb-[18px] transition-shadow duration-200 sm:px-[26px] sm:pt-6 sm:pb-[22px]",
        job.focused_at && "ring-brand ring-2 ring-inset",
        job.hidden_at && "opacity-60",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/freelancing/jobs/${job.id}`}
            className="text-xl leading-tight font-semibold tracking-tight text-balance hover:underline after:absolute after:inset-0 after:rounded-[30px]"
          >
            {job.title}
          </Link>
          <p className="text-subtle mt-1 text-[13px] font-medium">
            Posted {timeAgo(job.published_at)}
            {job.renewed_at && ` · renewed ${timeAgo(job.renewed_at)}`}
            {job.category && ` · ${job.subcategory ?? job.category}`}
          </p>
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-1.5">
          {job.track_stage && (
            <StatusBadge tone={STAGE_TONE[job.track_stage]} className="mr-1.5 hidden sm:inline-flex">
              {STAGE_LABEL[job.track_stage]}
            </StatusBadge>
          )}
          <FocusButton job={job} onChange={onChange} />
          <Tooltip>
            <TooltipTrigger asChild>
              <IconAction
                aria-label={job.hidden_at ? "Show this job again" : "Hide this job"}
                disabled={hide.isPending}
                onClick={() => hide.mutate()}
              >
                <EyeOff />
              </IconAction>
            </TooltipTrigger>
            <TooltipContent>{job.hidden_at ? "Unhide" : "Hide from results"}</TooltipContent>
          </Tooltip>
          {job.url && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconAction asChild>
                  <a href={job.url} target="_blank" rel="noreferrer" aria-label="Open on Upwork">
                    <ExternalLink />
                  </a>
                </IconAction>
              </TooltipTrigger>
              <TooltipContent>Open on Upwork</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="mt-4">
        <JobMetaChips job={job} />
      </div>

      {excerpt && (
        <p className="text-foreground/70 mt-3.5 text-[14.5px] leading-[1.55] text-pretty">{excerpt}</p>
      )}

      {job.skills.length > 0 && (
        <ul className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {job.skills.slice(0, 8).map((skill) => (
            <li key={skill}>
              <Badge variant="outline" className="font-semibold">
                {skill}
              </Badge>
            </li>
          ))}
          {job.skills.length > 8 && (
            <li className="text-subtle px-1 text-xs font-medium">+{job.skills.length - 8}</li>
          )}
        </ul>
      )}

      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3.5 text-[13px] font-medium">
        {job.client.payment_verified ? (
          <span className="text-success inline-flex items-center gap-1.5 font-bold">
            <BadgeCheck className="size-[15px]" />
            Payment verified
          </span>
        ) : job.client.payment_verified === false ? (
          <span className="font-semibold">Payment unverified</span>
        ) : (
          <span className="font-semibold">Payment status unknown</span>
        )}
        {client && <span>{client}</span>}
        {job.proposal_count > 0 && (
          <span className="bg-accent text-accent-foreground ml-auto rounded-full px-3 py-[3px] font-bold">
            {job.proposal_count} {job.proposal_count === 1 ? "proposal here" : "proposals here"}
          </span>
        )}
      </div>
    </Card>
  );
}
