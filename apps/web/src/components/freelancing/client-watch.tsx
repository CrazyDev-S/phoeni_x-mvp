"use client";

import { Eye } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clientIsHere, timeAgo, type JobCard, type JobWatcher } from "@/lib/freelancing";
import { cn } from "@/lib/utils";

/** "Dana (relays), Sam" - who has the posting open in the extension right now. */
export function watcherNames(watchers: JobWatcher[]): string {
  return watchers.map((w) => (w.you ? "You" : w.name) + (w.relay ? " (relays)" : "")).join(", ");
}

/** The pulsing dot for a client on the posting right now. */
export function HereDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-2 shrink-0", className)} aria-hidden>
      <span className="bg-brand absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden" />
      <span className="bg-brand relative size-2 rounded-full" />
    </span>
  );
}

/** Beside a posting's title in the list: someone's extension is watching its client. */
export function WatchChip({ job }: { job: Pick<JobCard, "watchers"> }) {
  if (!job.watchers.length) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-brand-ink bg-brand-soft inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium tabular-nums">
          <Eye className="size-3" />
          {job.watchers.length}
        </span>
      </TooltipTrigger>
      <TooltipContent>Watching the client: {watcherNames(job.watchers)}</TooltipContent>
    </Tooltip>
  );
}

/** When the client was last on the posting; teal while they are on it now. */
export function ClientActive({ job }: { job: Pick<JobCard, "client_activity_at" | "interviewing"> }) {
  if (!job.client_activity_at) return <>-</>;
  const here = clientIsHere(job.client_activity_at);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", here && "text-brand-ink font-medium")}
      title={job.interviewing != null ? `${job.interviewing} interviewing` : undefined}
    >
      {here && <HereDot />}
      {here ? "Now" : timeAgo(job.client_activity_at)}
    </span>
  );
}
