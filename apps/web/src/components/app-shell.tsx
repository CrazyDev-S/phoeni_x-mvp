"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { Brand } from "@/components/brand";
import { ModeToggle } from "@/components/mode-toggle";
import { NotificationsMenu } from "@/components/notifications-menu";
import { UserMenu } from "@/components/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { tokens } from "@/lib/api";

const PUBLIC = ["/login", "/register"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
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

  if (isPublic) return <main className="min-h-svh">{children}</main>;

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-background min-w-0">
        <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          {/* Below md the sidebar is off-canvas, taking the brand with it. */}
          <Link href="/" aria-label="Phoenix Eye home" className="flex md:hidden">
            <Brand size="sm" />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ModeToggle />
            <NotificationsMenu />
            <Separator orientation="vertical" className="mx-1 !h-6" />
            <UserMenu />
          </div>
        </header>

        <main
          // Keyed on the route so each navigation replays the entrance rather
          // than animating only on first mount.
          key={pathname}
          className="page-enter mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
