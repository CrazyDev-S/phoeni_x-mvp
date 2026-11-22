"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye, UsersRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { request } from "@/lib/api";
import { alertHeadline, timeAgo, type TeamAlert, type TeamAlertFeed } from "@/lib/freelancing";

const SEEN_KEY = "ra.clientAlerts.seen";

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * The team's client alerts: what a teammate's watch relayed about a posting's
 * client. Polled while the portal is open; a new one that this user's own
 * watch did not already tell them about pops a toast, and lights the bell
 * until the menu is opened.
 */
export function useClientAlerts(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["client-alerts"],
    queryFn: () => request<TeamAlertFeed>("/api/v1/freelancing/alerts?limit=8"),
    refetchInterval: 20_000,
    enabled,
  });
  const items = data?.items ?? [];
  const [seen, setSeen] = useState(readSeen);
  // Alerts already there when the page loaded are history, not news.
  const toasted = useRef<number | null>(null);

  useEffect(() => {
    if (!data) return;
    if (toasted.current !== null) {
      data.items
        .filter((alert) => alert.id > toasted.current! && !alert.local)
        .reverse()
        .forEach(announce);
    }
    toasted.current = data.cursor;
  }, [data]);

  const markSeen = useCallback(() => {
    const newest = items[0]?.id ?? 0;
    if (newest <= seen) return;
    setSeen(newest);
    try {
      localStorage.setItem(SEEN_KEY, String(newest));
    } catch {}
  }, [items, seen]);

  const unread = items.filter((alert) => !alert.local && alert.id > seen).length;
  return { items, unread, seen, markSeen };
}

function byline(alert: TeamAlert): string {
  return [timeAgo(alert.occurred_at), alert.local ? "your watch" : alert.relay_name && `via ${alert.relay_name}`]
    .filter(Boolean)
    .join(" · ");
}

function announce(alert: TeamAlert) {
  toast(alertHeadline(alert), {
    description: `${alert.title} · ${byline(alert)}`,
    icon: alert.kind === "client_viewed" ? <Eye className="text-brand size-4" /> : <UsersRound className="text-brand size-4" />,
    duration: 12_000,
    action: alert.url
      ? { label: "Open on Upwork", onClick: () => window.open(alert.url!, "_blank", "noreferrer") }
      : undefined,
  });
}

/** The bell's "Client activity" section. */
export function ClientAlertItems({ items, seen }: { items: TeamAlert[]; seen: number }) {
  return (
    <>
      <DropdownMenuLabel>Client activity</DropdownMenuLabel>
      {!items.length ? (
        <p className="text-muted-foreground px-2 pt-1 pb-3 text-xs">No client activity yet.</p>
      ) : (
        items.map((alert) => {
          const Icon = alert.kind === "client_viewed" ? Eye : UsersRound;
          return (
            <DropdownMenuItem key={alert.id} asChild className="items-start gap-2.5 py-2">
              <Link href={`/freelancing/jobs/${alert.job_id}`}>
                <Icon className="text-brand mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{alert.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {alertHeadline(alert)} · {byline(alert)}
                  </span>
                </span>
                {!alert.local && alert.id > seen && (
                  <span className="bg-brand mt-1.5 size-1.5 shrink-0 rounded-full" aria-label="New" />
                )}
              </Link>
            </DropdownMenuItem>
          );
        })
      )}
    </>
  );
}
