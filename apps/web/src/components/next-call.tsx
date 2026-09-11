"use client";

import { useQuery } from "@tanstack/react-query";

import { request } from "@/lib/api";
import { fmt, relative, IMMINENT_MINUTES } from "@/lib/format";
import { Badge } from "./ui";

export interface Upcoming {
  meeting: { id: string; title: string; starts_at: string; conferencing_url: string | null };
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
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        imminent
          ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)]"
      }`}
    >
      <Badge tone={imminent ? "brand" : "neutral"}>Next call</Badge>
      <span className="font-medium">{data.meeting.title}</span>
      {data.company_name && (
        <span className="text-[var(--color-ink-soft)]">
          {data.company_name}
          {data.stage_name && ` · ${data.stage_name}`}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        <span className="text-[var(--color-ink-soft)]">{fmt(data.meeting.starts_at)}</span>
        <strong>{relative(data.starts_in_minutes)}</strong>
        {data.meeting.conferencing_url && (
          <a
            href={data.meeting.conferencing_url}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-brand)] underline"
          >
            Join
          </a>
        )}
      </span>
    </div>
  );
}
