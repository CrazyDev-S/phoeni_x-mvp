"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays } from "lucide-react";
import Link from "next/link";

import { ClientAlertItems, useClientAlerts } from "@/components/freelancing/client-alerts";
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
 * What needs acting on now, rather than a generic notification feed.
 *
 * Two things in this product are genuinely time-sensitive: the next call, and
 * (in Freelancing) a client coming back to a posting a teammate is watching.
 * The dot appears only for a call close enough to act on or an alert not yet seen.
 */
export function NotificationsMenu() {
  const portal = usePortal();
  const calendar = portal ? portalPath(portal, "calendar") : "/";
  const freelancing = portal === "freelancing";
  const alerts = useClientAlerts(freelancing);
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
  const unread = freelancing ? alerts.unread : 0;
  const label = [unread && `${unread} new client alerts`, imminent && `${imminent} upcoming calls`]
    .filter(Boolean)
    .join(", ");

  return (
    <DropdownMenu onOpenChange={(open) => !open && alerts.markSeen()}>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 relative grid size-8 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
          aria-label={label || "Notifications"}
        >
          <Bell className="size-4" />
          {(imminent > 0 || unread > 0) && (
            <span
              className={`ring-card absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ${imminent ? "bg-destructive" : "bg-brand animate-pulse"}`}
            />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        {freelancing && (
          <>
            <ClientAlertItems items={alerts.items} seen={alerts.seen} />
            <DropdownMenuSeparator />
          </>
        )}
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
