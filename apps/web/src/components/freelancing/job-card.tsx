"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, EyeOff, Star, Users } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

/** The star. Focus is the first stage of the tracker, so this is where tracking starts. */
export function FocusButton({
  job,
  onChange,
  size = "sm",
}: {
  job: Pick<JobCardData, "id" | "focused_at" | "title">;
  onChange?: (next: JobCardData) => void;
  size?: "sm" | "default";
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={size === "sm" ? "icon-sm" : "icon"}
          variant="ghost"
          aria-pressed={focused}
          aria-label={focused ? `Unfocus ${job.title}` : `Focus ${job.title}`}
          disabled={toggle.isPending}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle.mutate();
          }}
          className={cn(focused ? "text-warning hover:text-warning" : "text-subtle hover:text-foreground")}
        >
          <Star className={cn(focused && "fill-current")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{focused ? "Focused - in your tracker" : "Focus this job"}</TooltipContent>
    </Tooltip>
  );
}

/** A meta chip: one fact about the posting. */
function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function JobMetaChips({ job, compact }: { job: JobCardData; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip className="bg-accent text-accent-foreground">{formatBudget(job)}</Chip>
      {job.experience_level && <Chip>{humanizeEnum(job.experience_level)}</Chip>}
      {job.duration_label && <Chip>{job.duration_label}</Chip>}
      {job.workload && !compact && <Chip>{job.workload}</Chip>}
      {job.total_applicants != null && (
        <Chip>
          <Users className="size-3" />
          {job.total_applicants} proposals
        </Chip>
      )}
      {job.connects_required != null && <Chip>{job.connects_required} connects</Chip>}
      {job.featured && <Chip className="bg-warning/10 text-warning">Featured</Chip>}
      {job.job_score != null && !compact && <Chip>Score {job.job_score.toFixed(1)}</Chip>}
      {job.is_premium && <Chip className="bg-warning/10 text-warning">Premium</Chip>}
      {job.is_enterprise && <Chip className="bg-info/10 text-info">Enterprise</Chip>}
      {job.applied && <Chip className="bg-success/10 text-success">Applied</Chip>}
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
        "relative gap-0 py-0 transition-shadow duration-200 hover:shadow-md",
        job.focused_at && "border-warning/40",
        job.hidden_at && "opacity-60",
      )}
    >
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Link
              href={`/freelancing/jobs/${job.id}`}
              className="text-base font-semibold text-balance hover:underline after:absolute after:inset-0"
            >
              {job.title}
            </Link>
            <p className="text-subtle mt-0.5 text-xs">
              Posted {timeAgo(job.published_at)}
              {job.renewed_at && ` · renewed ${timeAgo(job.renewed_at)}`}
              {job.category && ` · ${job.subcategory ?? job.category}`}
            </p>
          </div>
          <div className="relative z-10 flex shrink-0 items-center gap-0.5">
            {job.track_stage && (
              <StatusBadge tone={STAGE_TONE[job.track_stage]} className="mr-1 hidden sm:inline-flex">
                {STAGE_LABEL[job.track_stage]}
              </StatusBadge>
            )}
            <FocusButton job={job} onChange={onChange} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-subtle hover:text-foreground"
                  aria-label={job.hidden_at ? "Show this job again" : "Hide this job"}
                  disabled={hide.isPending}
                  onClick={() => hide.mutate()}
                >
                  <EyeOff />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{job.hidden_at ? "Unhide" : "Hide from results"}</TooltipContent>
            </Tooltip>
            {job.url && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild size="icon-sm" variant="ghost" className="text-subtle hover:text-foreground">
                    <a href={job.url} target="_blank" rel="noreferrer" aria-label="Open on Upwork">
                      <ExternalLink />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open on Upwork</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        <JobMetaChips job={job} />

        {excerpt && (
          <p className="text-muted-foreground text-sm leading-relaxed text-pretty">{excerpt}</p>
        )}

        {job.skills.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {job.skills.slice(0, 8).map((skill) => (
              <li key={skill} className="rounded-full border px-2 py-0.5 text-xs">
                {skill}
              </li>
            ))}
            {job.skills.length > 8 && (
              <li className="text-subtle px-1 py-0.5 text-xs">+{job.skills.length - 8}</li>
            )}
          </ul>
        )}

        <div className="text-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {job.client.payment_verified ? (
            <span className="text-success inline-flex items-center gap-1">
              <BadgeCheck className="size-3.5" />
              Payment verified
            </span>
          ) : job.client.payment_verified === false ? (
            <span>Payment unverified</span>
          ) : (
            <span>Payment status unknown</span>
          )}
          {client && <span>{client}</span>}
          {job.proposal_count > 0 && (
            <span className="text-primary">
              {job.proposal_count} {job.proposal_count === 1 ? "proposal here" : "proposals here"}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
