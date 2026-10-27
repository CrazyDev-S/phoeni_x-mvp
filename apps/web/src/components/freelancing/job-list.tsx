"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, EyeOff, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { request } from "@/lib/api";
import {
  formatBudget,
  humanizeEnum,
  invalidateFreelancing,
  STAGE_LABEL,
  STAGE_TONE,
  timeAgo,
  type JobCard as JobCardData,
  type JobClient,
} from "@/lib/freelancing";
import { cn } from "@/lib/utils";

/**
 * The star. Focus is the first stage of the tracker, so this is where tracking
 * starts. An icon button in a list row; a labelled button on the posting's page.
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
        variant="outline"
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
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-pressed={focused}
          aria-label={label}
          disabled={toggle.isPending}
          onClick={press}
          className={cn(
            "text-muted-foreground size-7",
            focused && "text-warning hover:text-warning",
          )}
        >
          <Star className={cn("size-4", focused && "fill-current")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{focused ? "Focused - in your tracker" : "Focus this job"}</TooltipContent>
    </Tooltip>
  );
}

/** The facts about a posting as small badges, for the posting's own page. */
export function JobMetaChips({ job }: { job: JobCardData }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {job.experience_level && <Badge variant="secondary">{humanizeEnum(job.experience_level)}</Badge>}
      {job.total_applicants != null && <Badge variant="secondary">{job.total_applicants} proposals</Badge>}
      {job.featured && <Badge variant="warning">Featured</Badge>}
      {job.job_score != null && <Badge variant="secondary">Score {job.job_score.toFixed(1)}</Badge>}
      {job.is_premium && <Badge variant="warning">Premium</Badge>}
      {job.is_enterprise && <Badge variant="info">Enterprise</Badge>}
      {job.applied && <Badge variant="success">Applied</Badge>}
    </div>
  );
}

function clientLine(client: JobClient) {
  const parts: string[] = [];
  if (client.country) parts.push(client.country);
  if (client.total_spent_display) parts.push(client.total_spent_display);
  else if (client.total_spent != null) parts.push(`$${Math.round(client.total_spent).toLocaleString()}`);
  if (client.feedback != null && client.feedback > 0) parts.push(`${client.feedback.toFixed(1)}★`);
  return parts.join(" · ");
}

function Row({
  job,
  onChange,
  onHidden,
}: {
  job: JobCardData;
  onChange?: (next: JobCardData) => void;
  onHidden?: (job: JobCardData) => void;
}) {
  const router = useRouter();
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
  const href = `/freelancing/jobs/${job.id}`;
  const client = clientLine(job.client);
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <TableRow
      onClick={() => router.push(href)}
      className={cn(
        "cursor-pointer",
        job.focused_at && "bg-accent/40 shadow-[inset_2px_0_0_var(--brand)]",
        job.hidden_at && "opacity-55",
      )}
    >
      <TableCell className="w-9 pr-0 pl-1.5">
        <FocusButton job={job} onChange={onChange} />
      </TableCell>
      <TableCell className="w-full max-w-0 min-w-44">
        <div className="flex items-center gap-2 overflow-hidden">
          <Link
            href={href}
            onClick={stop}
            className="min-w-20 shrink-[3] truncate text-[13px] font-medium hover:underline"
            title={job.title}
          >
            {job.title}
          </Link>
          {job.track_stage && (
            <StatusBadge tone={STAGE_TONE[job.track_stage]} className="shrink-0">
              {STAGE_LABEL[job.track_stage]}
            </StatusBadge>
          )}
          {job.applied && !job.track_stage && (
            <Badge variant="success" className="shrink-0">
              Applied
            </Badge>
          )}
          {job.featured && (
            <Badge variant="warning" className="shrink-0 max-md:hidden">
              Featured
            </Badge>
          )}
          {job.proposal_count > 0 && (
            <Badge variant="outline" className="shrink-0 max-md:hidden">
              {job.proposal_count} {job.proposal_count === 1 ? "proposal" : "proposals"}
            </Badge>
          )}
          <span className="text-muted-foreground hidden min-w-0 flex-1 truncate text-xs xl:inline">
            {[job.experience_level && humanizeEnum(job.experience_level), job.skills.slice(0, 6).join(", ")]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-[13px] font-medium">{formatBudget(job)}</TableCell>
      <TableCell className="text-muted-foreground hidden max-w-56 truncate text-xs md:table-cell">
        <span className="inline-flex items-center gap-1">
          {job.client.payment_verified ? (
            <BadgeCheck className="text-success size-3.5 shrink-0" aria-label="Payment verified" />
          ) : (
            <span className="text-subtle" title={job.client.payment_verified === false ? "Payment unverified" : "Payment status unknown"}>
              ?
            </span>
          )}
          <span className="truncate">{client || "-"}</span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground hidden text-right text-xs tabular-nums md:table-cell">
        {job.total_applicants ?? "-"}
      </TableCell>
      <TableCell className="text-muted-foreground hidden text-xs md:table-cell">{timeAgo(job.published_at)}</TableCell>
      <TableCell className="w-16 pr-1.5 pl-0" onClick={stop}>
        <div className="flex items-center justify-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground size-7"
                aria-label={job.hidden_at ? "Show this job again" : "Hide this job"}
                disabled={hide.isPending}
                onClick={() => hide.mutate()}
              >
                <EyeOff className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{job.hidden_at ? "Unhide" : "Hide from results"}</TooltipContent>
          </Tooltip>
          {job.url && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon-xs" variant="ghost" className="text-muted-foreground size-7">
                  <a href={job.url} target="_blank" rel="noreferrer" aria-label="Open on Upwork">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open on Upwork</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Search results and the focused list as one table: a row per posting, the
 * facts in columns. Clicking a row opens the posting; the star, hide and
 * Upwork buttons are their own targets.
 */
export function JobList({
  jobs,
  onChange,
  onHidden,
}: {
  jobs: JobCardData[];
  onChange?: (next: JobCardData) => void;
  onHidden?: (job: JobCardData) => void;
}) {
  return (
    <Panel>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-9" />
            <TableHead>Job</TableHead>
            <TableHead>Budget</TableHead>
            <TableHead className="hidden md:table-cell">Client</TableHead>
            <TableHead className="hidden text-right md:table-cell">Bids</TableHead>
            <TableHead className="hidden md:table-cell">Posted</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <Row key={job.id} job={job} onChange={onChange} onHidden={onHidden} />
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
