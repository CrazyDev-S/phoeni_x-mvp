import {
  Briefcase,
  CalendarDays,
  FileSignature,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  MessageSquareText,
  Search,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";

import { portalPath, type PortalId } from "@/lib/portals";

export interface NavItem {
  href: string;
  label: string;
  /** What the left rail says under the icon, when the full label is too long for it. */
  railLabel?: string;
  Icon: ComponentType<{ className?: string }>;
  /** Exact match only, so a portal's home does not light up on every child route. */
  exact?: boolean;
  /** A short trailing word, for a page that exists but is not built yet. */
  badge?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** What only this portal does. */
const WORKSPACE: Record<PortalId, NavItem[]> = {
  freelancing: [
    { href: portalPath("freelancing"), label: "Overview", Icon: LayoutDashboard, exact: true },
    { href: portalPath("freelancing", "jobs"), label: "Jobs", Icon: Search },
    { href: portalPath("freelancing", "proposals"), label: "Proposals", Icon: FileSignature },
    { href: portalPath("freelancing", "tracking"), label: "Pipeline", Icon: KanbanSquare },
    { href: portalPath("freelancing", "profile"), label: "Profile", Icon: UserRound },
  ],
  remote: [
    { href: portalPath("remote"), label: "Overview", Icon: LayoutDashboard, exact: true },
    { href: portalPath("remote", "resumes"), label: "Resumes", Icon: FileText },
    { href: portalPath("remote", "tailor"), label: "Tailor", Icon: Sparkles },
    { href: portalPath("remote", "applications"), label: "Applications", Icon: Briefcase },
  ],
};

/** The same three tools in both portals, each scoped to the one it is opened from. */
function tools(portal: PortalId): NavItem[] {
  return [
    { href: portalPath(portal, "calendar"), label: "Calendar", Icon: CalendarDays },
    { href: portalPath(portal, "maintenance"), label: "Job Maintenance", railLabel: "Maintenance", Icon: Wrench },
    {
      href: portalPath(portal, "interview"),
      label: "Interview Assist",
      railLabel: "Interview",
      Icon: MessageSquareText,
      badge: "Soon",
    },
  ];
}

export function navFor(portal: PortalId): NavSection[] {
  return [
    { label: "Workspace", items: WORKSPACE[portal] },
    { label: "Tools", items: tools(portal) },
  ];
}
