"use client";

import { ChevronsLeft, ChevronsRight, LayoutGrid, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";

import { Brand } from "@/components/brand";
import { navFor, type NavSection } from "@/components/portal/nav";
import { PORTALS, type PortalId } from "@/lib/portals";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ra.sidebar";

function sectionsFor(portal: PortalId | null): NavSection[] {
  if (!portal) {
    return [
      {
        label: "",
        items: [
          { href: "/", label: "Portals", Icon: LayoutGrid, exact: true },
          { href: "/settings", label: "Settings", Icon: Settings },
        ],
      },
    ];
  }
  return navFor(portal);
}

function Item({
  href,
  label,
  railLabel,
  Icon,
  active,
  badge,
  collapsed,
}: {
  href: string;
  label: string;
  railLabel?: string;
  Icon: ComponentType<{ className?: string }>;
  active: boolean;
  badge?: string;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring/40 relative flex h-8 items-center gap-2.5 rounded-md text-[13px] outline-none focus-visible:ring-2",
        collapsed ? "w-9 justify-center" : "px-2.5",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {badge && !collapsed && (
        <span className="bg-brand text-brand-foreground ml-auto rounded px-1 text-[10px] leading-4 font-semibold">
          {badge}
        </span>
      )}
      {badge && collapsed && <span className="bg-brand absolute top-1 right-1 size-1.5 rounded-full" />}
    </Link>
  );
}

/**
 * The left sidebar: a labelled list of the portal's pages, collapsible to an
 * icon column (remembered between visits). From md up it is a full-height
 * column; on a phone it becomes an icon bar along the bottom.
 */
export function Sidebar({ portal, pathname }: { portal: PortalId | null; pathname: string }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);
  function toggle() {
    setCollapsed((was) => {
      localStorage.setItem(STORAGE_KEY, was ? "0" : "1");
      return !was;
    });
  }

  const sections = sectionsFor(portal);
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <>
      <aside
        aria-label={portal ? PORTALS[portal].name : "PhoeniX"}
        className={cn(
          "bg-card sticky top-0 hidden h-svh shrink-0 flex-col border-r md:flex",
          collapsed ? "w-[52px]" : "w-[200px]",
        )}
      >
        <div className={cn("flex h-11 shrink-0 items-center border-b", collapsed ? "justify-center" : "px-3")}>
          <Link
            href={portal ? PORTALS[portal].path : "/"}
            aria-label="PhoeniX home"
            className="focus-visible:ring-ring/40 flex rounded outline-none focus-visible:ring-2"
          >
            {collapsed ? (
              <Image src="/phoenix-mark.png" alt="PhoeniX" width={24} height={24} className="size-6" />
            ) : (
              <Brand size="bar" />
            )}
          </Link>
        </div>

        <nav className={cn("no-scrollbar flex-1 overflow-y-auto py-2", collapsed ? "px-2" : "px-2")}>
          {sections.map((section, index) => (
            <div key={section.label || index} className={cn(index > 0 && "mt-3 border-t pt-3")}>
              {section.label && !collapsed && (
                <p className="text-subtle px-2.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                  {section.label}
                </p>
              )}
              <div className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
                {section.items.map((item) => (
                  <Item
                    key={item.href}
                    {...item}
                    active={isActive(item.href, item.exact)}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-foreground/5 focus-visible:ring-ring/40 m-2 flex h-8 items-center gap-2.5 rounded-md text-xs outline-none focus-visible:ring-2",
            collapsed ? "w-9 justify-center self-center" : "px-2.5",
          )}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>

      <nav
        aria-label={portal ? "Workspace" : "PhoeniX"}
        className="bg-card no-scrollbar fixed inset-x-0 bottom-0 z-30 flex h-12 items-center gap-1 overflow-x-auto border-t px-2 md:hidden"
      >
        {sections
          .flatMap((section) => section.items)
          .map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-2 text-[10px]",
                  active ? "bg-accent text-accent-foreground font-medium" : "text-foreground/70",
                )}
              >
                <item.Icon className="size-4" />
                {item.railLabel ?? item.label}
              </Link>
            );
          })}
      </nav>
    </>
  );
}
