"use client";

import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, Globe } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { PageHero } from "@/components/page-hero";
import { Panel } from "@/components/panel";
import { DownloadExtension } from "@/components/portal/download-extension";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { nameOf, useMe } from "@/hooks/use-me";
import { request } from "@/lib/api";
import { PORTALS, type PortalId } from "@/lib/portals";

interface Page {
  total: number;
}

/** GET /api/v1/freelancing/tracks/summary: one count per track status. */
interface TrackSummary {
  focused: number;
  submitted: number;
  interviewing: number;
}

/**
 * The portal picker: one row per portal, with the numbers that say how much is
 * in flight there and the way in. Everything else lives inside a portal.
 */
export default function HomePage() {
  const { data: me } = useMe();
  const name = me ? nameOf(me).split(" ")[0] : null;

  return (
    <div className="space-y-3">
      <PageHero
        title={name ? `Welcome back, ${name}` : "Welcome back"}
        actions={<DownloadExtension />}
        // The title is nowrap by default; on a phone a long name has to wrap.
        className="[&_h1]:max-md:whitespace-normal"
      />

      <Panel>
        <ul className="divide-border divide-y">
          <FreelancingRow />
          <RemoteRow />
        </ul>
      </Panel>
    </div>
  );
}

function FreelancingRow() {
  // A failed request is a dash on the card, not an error banner on the picker.
  const summary = useQuery({
    queryKey: ["freelancing", "tracks", "summary"],
    queryFn: () => request<TrackSummary>("/api/v1/freelancing/tracks/summary"),
    retry: false,
  });

  return (
    <PortalRow
      portal="freelancing"
      stats={[
        {
          label: "Saved",
          value: summary.data?.focused,
          loading: summary.isLoading,
        },
        {
          label: "Submitted",
          value: summary.data?.submitted,
          loading: summary.isLoading,
        },
        {
          label: "Interviewing",
          value: summary.data?.interviewing,
          loading: summary.isLoading,
        },
      ]}
    />
  );
}

function RemoteRow() {
  // Same keys as the Remote overview, so the numbers there come from cache.
  const resumes = useQuery({
    queryKey: ["resumes", ""],
    queryFn: () => request<Page>("/api/v1/remote/resumes"),
    retry: false,
  });
  const tailored = useQuery({
    queryKey: ["tailored-resumes"],
    queryFn: () => request<Page>("/api/v1/remote/tailored-resumes?limit=50"),
    retry: false,
  });
  const applications = useQuery({
    queryKey: ["applications", "all"],
    queryFn: () => request<Page>("/api/v1/remote/applications"),
    retry: false,
  });

  return (
    <PortalRow
      portal="remote"
      stats={[
        {
          label: "Resumes",
          value: resumes.data?.total,
          loading: resumes.isLoading,
        },
        {
          label: "Tailored",
          value: tailored.data?.total,
          loading: tailored.isLoading,
        },
        {
          label: "Applications",
          value: applications.data?.total,
          loading: applications.isLoading,
        },
      ]}
    />
  );
}

interface Stat {
  label: string;
  /** Undefined once loading has finished means the request failed. */
  value: number | undefined;
  loading: boolean;
}

const PORTAL_ICON: Record<PortalId, ComponentType<{ className?: string }>> = {
  freelancing: BriefcaseBusiness,
  remote: Globe,
};

/** One portal: what it is, how much is in flight there, and the way in. */
function PortalRow({ portal, stats }: { portal: PortalId; stats: Stat[] }) {
  const { name, path, tagline } = PORTALS[portal];
  const Icon = PORTAL_ICON[portal];

  return (
    // data-portal re-themes this row alone, so it shows the accent the portal
    // will have once it is open.
    <li data-portal={portal} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
      <span className="bg-brand text-brand-foreground grid size-7 shrink-0 place-items-center rounded-md">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[13px] font-semibold">{name}</p>
        <p className="text-muted-foreground truncate text-xs">{tagline}</p>
      </div>
      <dl className="flex items-baseline gap-5 text-xs">
        {stats.map(({ label, value, loading }) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dd className="text-[13px] font-semibold tabular-nums">
              {loading ? <Skeleton className="inline-block h-3.5 w-5 align-middle" /> : (value ?? "—")}
            </dd>
            <dt className="text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>
      <Button asChild variant="brand" size="sm">
        <Link href={path}>Open</Link>
      </Button>
    </li>
  );
}
