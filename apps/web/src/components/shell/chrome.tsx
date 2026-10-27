"use client";

import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import type { PortalId } from "@/lib/portals";

/**
 * The frame around every signed-in page: the sidebar, the top bar, and the page
 * itself running the full width of what is left. `portal` is null on the portal
 * picker and in Settings, where the sidebar offers only the way home and the
 * account.
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
    <div className="flex min-h-svh w-full">
      <Sidebar portal={portal} pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar portal={portal} />
        <main
          // Keyed on the route so each navigation replays the short fade.
          key={pathname}
          className="page-enter min-w-0 flex-1 space-y-3 p-3 pb-16 md:p-4"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
