"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

import type { Upcoming } from "@/components/shared/next-call";
import { usePortal } from "@/hooks/use-portal";
import { request } from "@/lib/api";
import { DISPLAY_TIME_ZONE } from "@/lib/format";
import { portalPath } from "@/lib/portals";

/** The strip shows from just before now to a few hours ahead. */
const LEAD_MIN = 15;
const SPAN_MIN = 240;
/** Events closer than this on the track would collide, so the later one is dropped. */
const MIN_GAP_PCT = 30;

function clock(date: Date) {
  return formatInTimeZone(date, DISPLAY_TIME_ZONE, "h:mm a").toLowerCase();
}

/**
 * "Your Schedule": today's next few calls on a short time track, a "now" marker
 * on it. The accent strip of the top bar. It reads the same upcoming-meetings
 * feed as the bell, scoped to the portal the page belongs to.
 */
export function ScheduleStrip() {
  const portal = usePortal();
  const calendar = portal ? portalPath(portal, "calendar") : "/";
  const [now, setNow] = useState<Date | null>(null);

  // Known only in the browser, so it is set after mount rather than guessed on the server.
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { data } = useQuery({
    queryKey: ["upcoming", portal],
    queryFn: () =>
      request<Upcoming[]>(
        `/api/v1/shared/meetings/upcoming?limit=6${portal ? `&category=${portal}` : ""}`,
      ),
    refetchInterval: 60_000,
  });

  const start = now ? now.getTime() - LEAD_MIN * 60_000 : 0;
  const end = start + SPAN_MIN * 60_000;
  const nowPct = (LEAD_MIN / SPAN_MIN) * 100;

  const events: { item: Upcoming; at: Date; pct: number }[] = [];
  if (now) {
    for (const item of [...(data ?? [])].sort((a, b) =>
      a.meeting.starts_at.localeCompare(b.meeting.starts_at),
    )) {
      const at = new Date(item.meeting.starts_at);
      if (at.getTime() < start || at.getTime() > end) continue;
      const pct = Math.min(86, Math.max(nowPct + 5, ((at.getTime() - start) / (end - start)) * 100));
      const last = events[events.length - 1];
      if (last && pct - last.pct < MIN_GAP_PCT) continue;
      events.push({ item, at, pct });
    }
  }

  return (
    <div className="bg-brand text-brand-foreground relative flex h-[52px] min-w-0 flex-1 items-center rounded-full px-2">
      {now && (
        <>
          <span
            aria-label={`Now, ${clock(now)}`}
            className="bg-panel absolute -top-2 bottom-1.5 w-0.5 rounded-full"
            style={{ left: `${nowPct}%` }}
          >
            <span className="bg-panel text-panel-foreground absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap">
              {clock(now)}
            </span>
            <span className="bg-panel absolute -bottom-0.5 -left-1 size-2.5 rounded-full" />
          </span>

          {events.length === 0 && (
            <span
              className="absolute text-[13px] font-semibold opacity-75"
              style={{ left: `${nowPct + 4}%` }}
            >
              No calls in the next few hours
            </span>
          )}

          {events.map(({ item, at, pct }, index) => (
            <span
              key={item.meeting.id}
              className="absolute top-1/2 flex -translate-y-1/2 items-center gap-2"
              style={{ left: `${pct}%` }}
            >
              <span aria-hidden className="absolute -left-2 h-7 w-px bg-black/25" />
              {index === 0 && item.meeting.conferencing_url ? (
                <a
                  href={item.meeting.conferencing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-card text-card-foreground flex h-10 items-center gap-2 rounded-full pr-4 pl-1.5 text-[13px] font-bold whitespace-nowrap"
                  title={`Join ${item.meeting.title}`}
                >
                  <span className="bg-panel text-brand grid size-7 place-items-center rounded-full">
                    <Video className="size-3.5" />
                  </span>
                  {clock(at)}
                  <span className="max-w-24 truncate font-semibold opacity-70">
                    {item.meeting.title}
                  </span>
                </a>
              ) : (
                <Link
                  href={calendar}
                  className="flex items-center gap-2 text-[13px] font-bold whitespace-nowrap"
                >
                  {clock(at)}
                  <span className="max-w-24 truncate font-semibold opacity-70">
                    {item.meeting.title}
                  </span>
                </Link>
              )}
            </span>
          ))}
        </>
      )}

      <Link
        href={calendar}
        aria-label="Open calendar"
        className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/10 transition-colors hover:bg-black/15"
      >
        <ArrowUpRight className="size-4" />
      </Link>
    </div>
  );
}
