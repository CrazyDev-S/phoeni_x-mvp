"use client";

import { BriefcaseBusiness, Globe } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { ScheduleStrip } from "@/components/shell/schedule-strip";
import { NotificationsMenu } from "@/components/shared/notifications-menu";
import { UserMenu } from "@/components/user-menu";
import { PORTALS, type PortalId } from "@/lib/portals";
import { cn } from "@/lib/utils";

const SWITCH: { id: PortalId; Icon: typeof Globe }[] = [
  { id: "freelancing", Icon: BriefcaseBusiness },
  { id: "remote", Icon: Globe },
];

/**
 * The 44px bar across the top: the portal switch, the next call as one line,
 * the bell and the account. The wordmark joins it on a phone, where the
 * sidebar is not on screen.
 */
export function TopBar({ portal }: { portal: PortalId | null }) {
  return (
    <header className="bg-card sticky top-0 z-20 flex h-11 shrink-0 items-center gap-3 border-b px-3 md:px-4">
      <Link
        href={portal ? PORTALS[portal].path : "/"}
        aria-label="PhoeniX home"
        className="flex shrink-0 rounded outline-none md:hidden"
      >
        <Brand size="sm" />
      </Link>

      <nav aria-label="Portals" className="bg-muted flex shrink-0 gap-0.5 rounded-md p-0.5">
        {SWITCH.map(({ id, Icon }) => (
          <Link
            key={id}
            href={PORTALS[id].path}
            aria-current={portal === id ? "page" : undefined}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
              portal === id
                ? "bg-brand text-brand-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            <span className="max-sm:sr-only">{PORTALS[id].name}</span>
          </Link>
        ))}
      </nav>

      <div className="min-w-0 flex-1" />
      <ScheduleStrip />
      <NotificationsMenu />
      <UserMenu />
    </header>
  );
}
