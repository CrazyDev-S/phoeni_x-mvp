"use client";

import { Rail } from "@/components/shell/rail";
import { TopBar } from "@/components/shell/top-bar";
import type { PortalId } from "@/lib/portals";

/**
 * The frame around every signed-in page: the top bar, the rail, and the page.
 * `portal` is null on the portal picker and in Settings, where the rail offers
 * only the way home and the account.
 */
export function Chrome({
  portal,
  pathname,
  children,
}: {
  portal: PortalId | null;
  pathname: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[1560px] flex-col gap-5 p-3 pb-28 md:p-6 md:pb-10">
      <TopBar portal={portal} />
      <div className="grid items-start gap-5 md:grid-cols-[88px_minmax(0,1fr)]">
        <Rail portal={portal} pathname={pathname} />
        <main
          // Keyed on the route so each navigation replays the entrance rather
          // than animating only on first mount.
          key={pathname}
          className="page-enter min-w-0 space-y-7 px-1 pt-1.5"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
