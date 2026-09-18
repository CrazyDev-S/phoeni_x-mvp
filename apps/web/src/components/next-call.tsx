"use client";

import { useQuery } from "@tanstack/react-query";
import { Video } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/api";
import { formatDateTime, relative, IMMINENT_MINUTES } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Upcoming {
  meeting: {
    id: string;
    title: string;
    starts_at: string;
    conferencing_url: string | null;
  };
  company_name: string | null;
  role_title: string | null;
  stage_name: string | null;
  kind: string;
  starts_in_minutes: number;
}

/** The single next call, across applications and maintained jobs. */
export function NextCallBanner() {
  const { data } = useQuery({
    queryKey: ["next-call"],
    queryFn: () => request<Upcoming | null>("/api/v1/meetings/next"),
    refetchInterval: 60_000,
  });

  if (!data) return null;
  const imminent = data.starts_in_minutes <= IMMINENT_MINUTES;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm",
        imminent ? "border-foreground/20 bg-muted" : "bg-card",
      )}
    >
      <StatusBadge tone={imminent ? "brand" : "neutral"}>Next call</StatusBadge>
      <span className="font-medium">{data.meeting.title}</span>
      {data.company_name && (
        <span className="text-muted-foreground">
          {data.company_name}
          {data.stage_name && ` · ${data.stage_name}`}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        <span className="text-muted-foreground tabular-nums">
          {formatDateTime(data.meeting.starts_at)}
        </span>
        <strong className="tabular-nums">{relative(data.starts_in_minutes)}</strong>
        {data.meeting.conferencing_url && (
          <Button asChild size="sm" variant={imminent ? "default" : "outline"}>
            <a href={data.meeting.conferencing_url} target="_blank" rel="noreferrer">
              <Video />
              Join
            </a>
          </Button>
        )}
      </span>
    </div>
  );
}
