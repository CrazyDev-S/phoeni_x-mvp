"use client";

import { useQuery } from "@tanstack/react-query";
import { Video } from "lucide-react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";

import type { Upcoming } from "@/components/shared/next-call";
import { usePortal } from "@/hooks/use-portal";
import { request } from "@/lib/api";
import { DISPLAY_TIME_ZONE, relative } from "@/lib/format";
import { portalPath } from "@/lib/portals";

/**
 * The next call, as one line in the top bar: when, what, and a join link when
 * the meeting has one. Reads the same upcoming-meetings feed as the bell,
 * scoped to the portal the page belongs to. Shows nothing when nothing is booked.
 */
export function ScheduleStrip() {
  const portal = usePortal();
  const calendar = portal ? portalPath(portal, "calendar") : "/";

  const { data } = useQuery({
    queryKey: ["upcoming", portal],
    queryFn: () =>
      request<Upcoming[]>(
        `/api/v1/shared/meetings/upcoming?limit=6${portal ? `&category=${portal}` : ""}`,
      ),
    refetchInterval: 60_000,
  });

  const next = data?.[0];
  if (!next) return null;
  const at = new Date(next.meeting.starts_at);
  const join = next.meeting.conferencing_url;

  return (
    <div className="hidden min-w-0 items-center gap-2 text-xs md:flex">
      <Link
        href={calendar}
        className="hover:text-foreground text-muted-foreground flex min-w-0 items-center gap-1.5"
        title={next.meeting.title}
      >
        <span className="text-foreground font-semibold tabular-nums">
          {formatInTimeZone(at, DISPLAY_TIME_ZONE, "EEE h:mm a")}
        </span>
        <span className="max-w-48 truncate">{next.meeting.title}</span>
        <span className="text-subtle">{relative(next.starts_in_minutes)}</span>
      </Link>
      {join && (
        <a
          href={join}
          target="_blank"
          rel="noreferrer"
          aria-label={`Join ${next.meeting.title}`}
          className="bg-brand text-brand-foreground grid size-6 place-items-center rounded-md"
        >
          <Video className="size-3.5" />
        </a>
      )}
    </div>
  );
}
