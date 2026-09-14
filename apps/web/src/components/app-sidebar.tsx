"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  Download,
  FileText,
  Home,
  Puzzle,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Exact match only, so "/" does not light up on every route. */
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Home", Icon: Home, exact: true },
  { href: "/resumes", label: "Resumes", Icon: FileText },
  { href: "/tailor", label: "Tailor", Icon: Sparkles },
  { href: "/applications", label: "Applications", Icon: Briefcase },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/maintenance", label: "Maintenance", Icon: Wrench },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="offcanvas">
      {/* Natural height rather than the top bar's h-16: the mark is 48px and
          needs air above it, not to be pinned flush against the edge. */}
      <SidebarHeader className="px-4 pt-5 pb-3">
        <Link
          href="/"
          onClick={() => setOpenMobile(false)}
          className="focus-visible:ring-ring flex w-fit rounded-lg focus-visible:ring-3 focus-visible:outline-none"
        >
          <Brand />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {NAV.map(({ href, label, Icon, exact }) => {
                const active = exact ? pathname === href : pathname.startsWith(href);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      className="h-10 gap-3 rounded-lg px-3 font-medium transition-colors duration-150"
                    >
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon className="size-4.5" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 p-3">
        <DownloadExtension />
        <PromoCard />
      </SidebarFooter>
    </Sidebar>
  );
}

/** Bytes as the rounded unit a download dialog would show. */
function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}

/**
 * The packaged browser extension.
 *
 * The portal serves whatever `npm run zip:ext` last built, so the button
 * reports the real size and reads as unavailable - rather than 404-ing - when
 * nothing has been packaged yet.
 */
function DownloadExtension() {
  const { data, isLoading } = useQuery({
    queryKey: ["extension-package"],
    queryFn: () =>
      fetch("/api/extension").then(
        (r) => r.json() as Promise<{ available: boolean; bytes?: number; builtAt?: string }>,
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading) return <Skeleton className="h-9 w-full rounded-lg" />;

  if (!data?.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="block">
            <Button variant="outline" size="sm" disabled className="w-full justify-start">
              <Puzzle />
              Browser extension
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">
          Not packaged yet — run <code className="font-mono">npm run zip:ext</code>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="w-full justify-start"
      title={`Packaged ${new Date(data.builtAt!).toLocaleDateString()}`}
    >
      {/* A real navigation, not fetch + object URL: the browser owns the save
          dialog and the download survives leaving this page. */}
      <a href="/api/extension/download" download>
        <Download />
        Download extension
        <span className="text-subtle ml-auto text-[11px] tabular-nums">
          {formatBytes(data.bytes!)}
        </span>
      </a>
    </Button>
  );
}

/**
 * The one piece of persuasion in the chrome.
 *
 * It points at a real page rather than a marketing site, so it reads as part
 * of the product rather than an advertisement inside it.
 */
function PromoCard() {
  const { setOpenMobile } = useSidebar();
  return (
    <div className="bg-accent text-accent-foreground relative overflow-hidden rounded-xl p-4">
      <span aria-hidden className="bg-gradient-brand absolute inset-x-0 top-0 h-1" />
      <Sparkles className="size-4.5" />
      <p className="text-foreground mt-2.5 text-sm font-semibold">Get better results</p>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        Tailor your resume to each job and increase your chances of getting hired.
      </p>
      <Link
        href="/tailor"
        onClick={() => setOpenMobile(false)}
        className="text-primary hover:bg-background/60 mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors"
      >
        Learn more
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
