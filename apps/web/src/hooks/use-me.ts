"use client";

import { useQuery } from "@tanstack/react-query";

import { request } from "@/lib/api";

export interface Me {
  id: string;
  email: string;
  display_name: string | null;
  timezone: string | null;
}

/** The signed-in user, for the header. Cached for the session; it rarely changes. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => request<Me>("/api/v1/auth/me"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** "dana.okafor@example.com" -> "DO"; a display name wins when there is one. */
export function initialsOf(me: Me | undefined): string {
  const source = me?.display_name?.trim() || me?.email?.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function nameOf(me: Me | undefined): string {
  if (!me) return "Account";
  if (me.display_name?.trim()) return me.display_name;
  const local = me.email.split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}
