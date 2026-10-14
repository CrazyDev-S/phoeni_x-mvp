"use client";

import { Calendar, Globe, BriefcaseBusiness } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

import { Brand } from "@/components/brand";
import { ScheduleStrip } from "@/components/shell/schedule-strip";
import { NotificationsMenu } from "@/components/shared/notifications-menu";
import { UserMenu } from "@/components/user-menu";
import { DISPLAY_TIME_ZONE } from "@/lib/format";
import { PORTALS, type PortalId } from "@/lib/portals";
import { cn } from "@/lib/utils";

const SWITCH: { id: PortalId; Icon: typeof Globe }[] = [
  { id: "freelancing", Icon: BriefcaseBusiness },
  { id: "remote", Icon: Globe },
];

/**
 * The charcoal pill across the top: the wordmark, the portal switch, today's
 * schedule on an accent strip, the bell and the account.
 */
export function TopBar({ portal }: { portal: PortalId | null }) {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(formatInTimeZone(new Date(), DISPLAY_TIME_ZONE, "d MMMM"));
  }, []);

  return (
    <header className="bg-panel text-panel-foreground flex h-[68px] items-center gap-3 rounded-full py-2 pr-2 pl-5 md:gap-3.5 md:pl-6">
      <Link
        href={portal ? PORTALS[portal].path : "/"}
        aria-label="PhoeniX home"
        className="focus-visible:ring-ring/50 flex shrink-0 rounded-lg outline-none focus-visible:ring-3"
      >
        <Brand size="bar" />
      </Link>

      <nav
        aria-label="Portals"
        className="bg-panel-raised/60 hidden shrink-0 gap-0.5 rounded-full p-1 sm:flex"
      >
        {SWITCH.map(({ id, Icon }) => (
          <Link
            key={id}
            href={PORTALS[id].path}
            aria-current={portal === id ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
              portal === id
                ? "bg-brand text-brand-foreground"
                : "text-panel-muted hover:text-panel-foreground",
            )}
          >
            <Icon className="size-[15px]" />
            {PORTALS[id].name}
          </Link>
        ))}
      </nav>

      <span className="hidden shrink-0 pl-1.5 text-[15px] font-semibold xl:block">Your Schedule</span>
      <span className="bg-panel-raised/60 hidden h-12 shrink-0 items-center gap-2.5 rounded-full pr-4 pl-2 text-sm font-semibold xl:flex">
        <span className="bg-panel-raised grid size-8 place-items-center rounded-full">
          <Calendar className="size-[15px]" />
        </span>
        {today || " "}
      </span>

      <div className="hidden min-w-0 flex-1 lg:flex">
        <ScheduleStrip />
      </div>
      <div className="flex-1 lg:hidden" />

      <NotificationsMenu />
      <UserMenu />
    </header>
  );
}
