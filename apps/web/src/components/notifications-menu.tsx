"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays } from "lucide-react";
import Link from "next/link";

import type { Upcoming } from "@/components/next-call";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { request } from "@/lib/api";
import { formatDateTime, relative, IMMINENT_MINUTES } from "@/lib/format";

/**
 * What is coming up, rather than a generic notification feed.
 *
 * The only thing in this product that is genuinely time-sensitive is the next
 * call, so that is what the bell shows - and the dot only appears when one is
 * close enough to act on.
 */
export function NotificationsMenu() {
  const { data } = useQuery({
    queryKey: ["upcoming"],
    queryFn: () => request<Upcoming[]>("/api/v1/meetings/upcoming?limit=6"),
    refetchInterval: 60_000,
  });

  const items = data ?? [];
  const imminent = items.filter((i) => i.starts_in_minutes <= IMMINENT_MINUTES).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={imminent ? `${imminent} upcoming calls` : "Upcoming calls"}
        >
          <Bell />
          {imminent > 0 && (
            <span className="bg-primary ring-background absolute top-1 right-1 size-2 rounded-full ring-2" />
          )}
        </Button>
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
              <Link href="/calendar">
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
          <Link href="/calendar">Open calendar</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
