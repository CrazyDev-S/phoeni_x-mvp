"use client";

import { usePathname } from "next/navigation";

import { portalOf, type PortalId } from "@/lib/portals";

/** The portal the current page belongs to, or null outside both. */
export function usePortal(): PortalId | null {
  return portalOf(usePathname());
}
