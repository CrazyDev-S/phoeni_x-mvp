"use client";

import { useQuery } from "@tanstack/react-query";

import { PageHero } from "@/components/page-hero";
import { Panel, PanelHead } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { request } from "@/lib/api";
import type { PortalId } from "@/lib/portals";

/** GET /api/v1/shared/interview/status. */
interface InterviewStatus {
  available: boolean;
  planned: string[];
}

/** The page is the same in both portals; `portal` is accepted so each route can name itself. */
export function InterviewPage(_: { portal: PortalId }) {
  // A missing endpoint just means no planned list.
  const status = useQuery({
    queryKey: ["shared", "interview", "status"],
    queryFn: () => request<InterviewStatus>("/api/v1/shared/interview/status"),
    retry: false,
  });
  const planned = Array.isArray(status.data?.planned) ? status.data.planned : [];

  return (
    <div className="space-y-3">
      <PageHero title="Interview Assist" badge={<Badge variant="brand">Coming soon</Badge>} />

      <Panel>
        <PanelHead title="Planned" count={planned.length || undefined} />
        <ul className="divide-border divide-y">
          {planned.length ? (
            planned.map((item) => (
              <li key={item} className="px-3 py-2 text-[13px]">
                {item}
              </li>
            ))
          ) : (
            <li className="text-muted-foreground px-3 py-2 text-[13px]">Not built yet.</li>
          )}
        </ul>
      </Panel>
    </div>
  );
}
