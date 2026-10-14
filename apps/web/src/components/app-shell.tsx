"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Chrome } from "@/components/shell/chrome";
import { Skeleton } from "@/components/ui/skeleton";
import { tokens } from "@/lib/api";
import { portalOf } from "@/lib/portals";

const PUBLIC = ["/login", "/register"];

/**
 * Sign-in guard, and the chrome for wherever the user is: the top bar and rail
 * (a portal's own inside Freelancing or Remote, the plain one on the portal
 * picker and in Settings), nothing at all on the sign-in pages.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const portal = portalOf(pathname);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Guard on the client: tokens live in web storage, not a cookie, so the
    // server cannot know whether this request is authenticated.
    if (!isPublic && !tokens.access() && !tokens.refresh()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [isPublic, pathname, router]);

  useEffect(() => {
    // The root layout's script set this before first paint; keep it right as
    // the user moves between portals without a reload.
    const root = document.documentElement;
    if (portal) root.dataset.portal = portal;
    else delete root.dataset.portal;
  }, [portal]);

  if (isPublic) return <main className="min-h-svh">{children}</main>;

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-[1560px] space-y-5 p-6" aria-busy>
        <Skeleton className="h-[68px] w-full rounded-full" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <Chrome portal={portal} pathname={pathname}>
      {children}
    </Chrome>
  );
}
