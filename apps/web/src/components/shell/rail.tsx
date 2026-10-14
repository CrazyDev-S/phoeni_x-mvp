"use client";

import { LayoutGrid, Settings } from "lucide-react";
import Link from "next/link";
import { Fragment, type ComponentType } from "react";

import { navFor } from "@/components/portal/nav";
import type { PortalId } from "@/lib/portals";
import { cn } from "@/lib/utils";

interface RailItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  exact?: boolean;
  badge?: string;
  /** A rule is drawn above this item. */
  divider?: boolean;
}

function itemsFor(portal: PortalId | null): RailItem[] {
  if (!portal) {
    return [
      { href: "/", label: "Portals", Icon: LayoutGrid, exact: true },
      { href: "/settings", label: "Settings", Icon: Settings },
    ];
  }
  return navFor(portal).flatMap((section, index) =>
    section.items.map((item, at) => ({
      href: item.href,
      label: item.railLabel ?? item.label,
      Icon: item.Icon,
      exact: item.exact,
      badge: item.badge,
      divider: index > 0 && at === 0,
    })),
  );
}

/**
 * The left rail: icon over label, the current page in a charcoal pill with an
 * accent icon. Beside the page from md up; a scrolling bar along the bottom
 * on a phone.
 */
export function Rail({ portal, pathname }: { portal: PortalId | null; pathname: string }) {
  const items = itemsFor(portal);
  return (
    <nav
      aria-label={portal ? "Workspace" : "PhoeniX"}
      className={cn(
        "bg-card shadow-card no-scrollbar flex gap-1 overflow-x-auto p-2",
        "fixed inset-x-3 bottom-3 z-30 rounded-full",
        "md:sticky md:inset-x-auto md:top-6 md:bottom-auto md:w-[88px] md:flex-col md:self-start md:overflow-visible md:rounded-[44px]",
      )}
    >
      {items.map(({ href, label, Icon, exact, badge, divider }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Fragment key={href}>
            {divider && <span aria-hidden className="bg-border mx-3.5 my-1.5 hidden h-px md:block" />}
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-16 min-w-[72px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[34px] text-[10.5px] font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 md:h-[72px]",
                active
                  ? "bg-primary text-primary-foreground [&_svg]:text-brand"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
              )}
            >
              <Icon className="size-[22px]" />
              {label}
              {badge && (
                <span className="bg-brand text-brand-foreground absolute top-2 right-2 rounded-full px-1.5 py-0.5 text-[8px] leading-none font-bold tracking-wide uppercase">
                  {badge}
                </span>
              )}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
