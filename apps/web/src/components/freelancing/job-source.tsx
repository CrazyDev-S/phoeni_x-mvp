"use client";

import { useQuery } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
    <Alert>
      <Plug />
      <AlertTitle>{data.label} is not set up</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{data.setup_hint ?? "Finish setting up the job source to search."}</span>
        <Button asChild size="sm" className="ml-auto">
          <Link href="/settings?tab=integrations">Open integrations</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
