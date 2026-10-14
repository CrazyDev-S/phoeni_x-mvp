/**
 * The two portals.
 *
 * Freelancing and Remote are separate places with their own navigation, home
 * and accent colour. Calendar, Job Maintenance and Interview Assist exist in
 * both, each scoped to the portal it is opened from.
 *
 * Deliberately free of hooks, components and "use client": the root layout is a
 * server component and inlines PORTAL_SCRIPT from here.
 */
export const PORTAL_IDS = ["freelancing", "remote"] as const;
export type PortalId = (typeof PORTAL_IDS)[number];

export interface PortalInfo {
  id: PortalId;
  name: string;
  /** The portal's home, and the prefix of every one of its routes. */
  path: `/${PortalId}`;
  tagline: string;
  /** Three swatches of the portal's accent, for chips and the picker. */
  swatches: readonly [string, string, string];
}

export const PORTALS: Record<PortalId, PortalInfo> = {
  freelancing: {
    id: "freelancing",
    name: "Freelancing",
    path: "/freelancing",
    tagline: "Search Upwork, draft proposals, and track every bid to payment.",
    swatches: ["#93c5fd", "#3b82f6", "#1d4ed8"],
  },
  remote: {
    id: "remote",
    name: "Remote",
    path: "/remote",
    tagline: "Tailor a resume to each posting, apply, and follow the interview loop.",
    swatches: ["#f6a228", "#f4562c", "#d32127"],
  },
};

/** The portal a pathname belongs to, or null on the portal picker and Settings. */
export function portalOf(pathname: string): PortalId | null {
  return PORTAL_IDS.find((id) => pathname === `/${id}` || pathname.startsWith(`/${id}/`)) ?? null;
}

/** A path inside a portal: portalPath("remote", "calendar") is "/remote/calendar". */
export function portalPath(portal: PortalId, page = ""): string {
  return page ? `${PORTALS[portal].path}/${page}` : PORTALS[portal].path;
}

/**
 * Sets data-portal on <html> before first paint, so the portal's accent never
 * flashes the other one. A string rather than a module: it has to run before
 * any bundle has loaded. AppShell keeps the attribute in step on navigation.
 */
export const PORTAL_SCRIPT = `try{var m=location.pathname.match(/^\\/(${PORTAL_IDS.join("|")})(\\/|$)/);if(m)document.documentElement.dataset.portal=m[1]}catch(e){}`;
