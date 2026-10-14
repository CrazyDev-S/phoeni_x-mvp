"use client";

import { useQuery } from "@tanstack/react-query";
import { Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePortal } from "@/hooks/use-portal";
import { request } from "@/lib/api";
import { formatDateTime, relative } from "@/lib/format";

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

/** The single next call in this portal: its applications, bids and maintained jobs. */
export function NextCallBanner() {
  const portal = usePortal();
  const { data } = useQuery({
    queryKey: ["next-call", portal],
    queryFn: () =>
      request<Upcoming | null>(
        `/api/v1/shared/meetings/next${portal ? `?category=${portal}` : ""}`,
      ),
    refetchInterval: 60_000,
  });

  if (!data) return null;

  return (
    <div className="bg-card shadow-card flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[2rem] py-2.5 pr-2.5 pl-[22px] text-sm sm:rounded-full">
      <Badge variant="brand" className="h-[30px] px-3.5 text-[0.8125rem]">
        Next call
      </Badge>
      <span className="text-base font-bold">{data.meeting.title}</span>
      {data.company_name && (
        <span className="text-muted-foreground text-sm font-medium">
          {data.company_name}
          {data.stage_name && ` · ${data.stage_name}`}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3.5">
        <span className="text-muted-foreground font-medium tabular-nums">
          {formatDateTime(data.meeting.starts_at, "EEE d MMM, h:mm aaa")}
        </span>
        <strong className="font-bold tabular-nums">{relative(data.starts_in_minutes)}</strong>
        {data.meeting.conferencing_url ? (
          <Button asChild variant="brand" className="h-11">
            <a href={data.meeting.conferencing_url} target="_blank" rel="noreferrer">
              <Video />
              Join
            </a>
          </Button>
        ) : (
          <span aria-hidden className="w-1.5" />
        )}
      </span>
    </div>
  );
}
