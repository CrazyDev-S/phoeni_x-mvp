"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  Download,
  FileSignature,
  FileText,
  Home,
  KanbanSquare,
  LayoutDashboard,
  MessageSquareText,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  UserRound,
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Exact match only, so "/" and "/remote" do not light up on every child route. */
  exact?: boolean;
  /** A short trailing word, for a page that exists but is not built yet. */
  badge?: string;
}

interface NavSection {
  /** No label for the entries that stand on their own (Home, Settings). */
  label?: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  { items: [{ href: "/", label: "Home", Icon: Home, exact: true }] },
  {
    label: "Freelancing",
    items: [
      { href: "/freelancing", label: "Overview", Icon: LayoutDashboard, exact: true },
      { href: "/freelancing/jobs", label: "Jobs", Icon: Search },
      { href: "/freelancing/proposals", label: "Proposals", Icon: FileSignature },
      { href: "/freelancing/tracking", label: "Tracking", Icon: KanbanSquare },
      { href: "/freelancing/profile", label: "Profile", Icon: UserRound },
    ],
  },
  {
    label: "Remote",
    items: [
      { href: "/remote", label: "Overview", Icon: LayoutDashboard, exact: true },
      { href: "/remote/resumes", label: "Resumes", Icon: FileText },
      { href: "/remote/tailor", label: "Tailor", Icon: Sparkles },
      { href: "/remote/applications", label: "Applications", Icon: Briefcase },
    ],
  },
  {
    label: "Shared tools",
    items: [
      { href: "/calendar", label: "Calendar", Icon: CalendarDays },
      { href: "/interview", label: "Interview Assist", Icon: MessageSquareText, badge: "Soon" },
      { href: "/maintenance", label: "Job Maintenance", Icon: Wrench },
    ],
  },
  { items: [{ href: "/settings", label: "Settings", Icon: Settings }] },
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
        {SECTIONS.map((section, index) => (
          <SidebarGroup key={section.label ?? index} className="py-1">
            {section.label && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {section.items.map(({ href, label, Icon, exact, badge }) => {
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
                      {badge && (
                        // The button is h-10 rather than the default h-8, so
                        // the badge's own top offset is overridden to stay centred.
                        <SidebarMenuBadge className="bg-warning/10 !text-warning !top-2.5 right-2 rounded-md px-1.5 text-[10px] font-semibold tracking-wide uppercase">
                          {badge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
      <p className="text-foreground mt-2.5 text-sm font-semibold">Bid smarter</p>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        Focus the Upwork jobs worth your connects, then draft the proposal from your profile.
      </p>
      <Link
        href="/freelancing/jobs"
        onClick={() => setOpenMobile(false)}
        className="text-primary hover:bg-background/60 mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors"
      >
        Learn more
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
