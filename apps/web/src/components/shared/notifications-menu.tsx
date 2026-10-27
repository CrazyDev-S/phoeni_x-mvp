"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays } from "lucide-react";
import Link from "next/link";

import type { Upcoming } from "@/components/shared/next-call";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePortal } from "@/hooks/use-portal";
import { request } from "@/lib/api";
import { formatDateTime, relative, IMMINENT_MINUTES } from "@/lib/format";
import { portalPath } from "@/lib/portals";

/**
 * What is coming up, rather than a generic notification feed.
 *
 * The only thing in this product that is genuinely time-sensitive is the next
 * call, so that is what the bell shows - and the dot only appears when one is
 * close enough to act on.
 */
export function NotificationsMenu() {
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

  const items = data ?? [];
  const imminent = items.filter((i) => i.starts_in_minutes <= IMMINENT_MINUTES).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 relative grid size-8 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
          aria-label={imminent ? `${imminent} upcoming calls` : "Upcoming calls"}
        >
          <Bell className="size-4" />
          {imminent > 0 && (
            <span className="bg-destructive ring-card absolute top-1.5 right-1.5 size-2 rounded-full ring-2" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Upcoming</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {!items.length ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            Nothing scheduled yet.
          </p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.meeting.id}
              asChild
              className="items-start gap-2.5 py-2"
            >
              <Link href={calendar}>
                <CalendarDays className="text-muted-foreground mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.meeting.title}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {formatDateTime(item.meeting.starts_at)} ·{" "}
                    {relative(item.starts_in_minutes)}
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={calendar}>Open calendar</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
