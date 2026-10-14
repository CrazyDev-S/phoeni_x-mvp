"use client";

import { useQuery } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { request } from "@/lib/api";
import type { JobSourceStatus } from "@/lib/freelancing";

export const SOURCE_QUERY = ["freelancing", "source"];

/** Which provider answers job searches, and whether this user can use it yet. */
export function useJobSource() {
  return useQuery({
    queryKey: SOURCE_QUERY,
    queryFn: () => request<JobSourceStatus>("/api/v1/freelancing/source"),
    staleTime: 30_000,
  });
}

/**
 * One line at the top of a Freelancing page when searching is not set up.
 *
 * Nothing on the page is hidden behind it: the focused list and the tracker
 * work regardless. Only searching does not.
 */
export function JobSourceBanner() {
  const { data } = useJobSource();
  if (!data || data.ready) return null;

  return (
    <div
      role="alert"
      className="bg-card shadow-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] px-4 py-2.5 text-sm"
    >
      <span className="bg-brand-soft text-brand-ink grid size-8 shrink-0 place-items-center rounded-full">
        <Plug className="size-4" />
      </span>
      <p className="min-w-0 flex-1 basis-60">
        <span className="font-semibold">{data.label} is not set up.</span>{" "}
        <span className="text-muted-foreground font-medium">
          {data.setup_hint ?? "Finish setting up the job source to search."}
        </span>
      </p>
      <Button asChild size="sm" className="shrink-0">
        <Link href="/settings?tab=integrations">Open integrations</Link>
      </Button>
    </div>
  );
}
