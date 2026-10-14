"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  Globe,
  MessageSquareText,
  Video,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { DownloadExtension } from "@/components/portal/download-extension";
import { navFor } from "@/components/portal/nav";
import { PageHero } from "@/components/page-hero";
import { SectionHead } from "@/components/section-head";
import type { Upcoming } from "@/components/shared/next-call";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notch } from "@/components/ui/notch";
import { Skeleton } from "@/components/ui/skeleton";
import { nameOf, useMe } from "@/hooks/use-me";
import { request } from "@/lib/api";
import { formatDateTime, relative } from "@/lib/format";
import { PORTAL_IDS, PORTALS, portalPath, type PortalId } from "@/lib/portals";

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
 * The portal picker.
 *
 * Two portals side by side, each in its own accent, with the three numbers that
 * say how much is in flight there. Everything else lives inside a portal.
 */
export default function HomePage() {
  const { data: me } = useMe();
  const name = me ? nameOf(me).split(" ")[0] : null;

  return (
    <div className="space-y-7">
      <PageHero
        title={name ? `Welcome back, ${name}` : "Welcome back"}
        description="Pick a portal. Each one has its own pages, calendar and job upkeep."
        actions={<DownloadExtension />}
        // The title is nowrap by default; on a phone a long name has to wrap.
        className="[&_h1]:max-md:whitespace-normal"
      />

      <NextCall />

      <section className="grid gap-5 lg:grid-cols-2">
        <FreelancingCard />
        <RemoteCard />
      </section>

      <SharedTools />
    </div>
  );
}

/**
 * The next call across both portals. The key matches the banner inside a
 * portal (with no portal), so the two share one request.
 */
function NextCall() {
  const { data } = useQuery({
    queryKey: ["next-call", null],
    queryFn: () => request<Upcoming | null>("/api/v1/shared/meetings/next"),
    refetchInterval: 60_000,
  });
  if (!data) return null;

  return (
    <div className="bg-panel text-panel-foreground flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[36px] p-4 pl-6 sm:pl-[30px]">
      <Badge variant="brand" className="h-[30px] px-3.5 text-[13px]">
        Next call
      </Badge>
      <div className="min-w-0 flex-1 basis-64">
        <div className="text-xl font-semibold tracking-tight text-pretty">
          {data.meeting.title}
        </div>
        {data.company_name && (
          <div className="text-panel-muted mt-0.5 text-sm font-medium">
            {data.company_name}
            {data.stage_name && ` · ${data.stage_name}`}
          </div>
        )}
      </div>
      <div className="ml-auto text-right">
        <strong className="text-brand block text-xl font-semibold tabular-nums">
          {relative(data.starts_in_minutes)}
        </strong>
        <span className="text-panel-muted text-[13.5px] font-medium tabular-nums">
          {formatDateTime(data.meeting.starts_at)}
        </span>
      </div>
      {data.meeting.conferencing_url && (
        <>
          <span
            aria-hidden
            className="bg-panel-raised hidden h-[38px] w-px sm:block"
          />
          <Button asChild variant="brand" size="lg" className="h-[52px] px-6">
            <a
              href={data.meeting.conferencing_url}
              target="_blank"
              rel="noreferrer"
            >
              <Video />
              Join
            </a>
          </Button>
        </>
      )}
    </div>
  );
}

function FreelancingCard() {
  // A failed request is a dash on the card, not an error banner on the picker.
  const summary = useQuery({
    queryKey: ["freelancing", "tracks", "summary"],
    queryFn: () => request<TrackSummary>("/api/v1/freelancing/tracks/summary"),
    retry: false,
  });

  return (
    <PortalCard
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

function RemoteCard() {
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
    <PortalCard
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
function PortalCard({ portal, stats }: { portal: PortalId; stats: Stat[] }) {
  const { name, path, tagline } = PORTALS[portal];
  const Icon = PORTAL_ICON[portal];
  // The portal's own pages, without its overview.
  const inside = navFor(portal)[0].items.filter((item) => !item.exact);

  return (
    // data-portal re-themes this card alone, so it shows the accent the portal
    // will have once it is open.
    <Card
      tone="accent"
      data-portal={portal}
      className="min-h-[34rem] gap-[26px] rounded-[44px] p-6 sm:p-[34px]"
    >
      <Notch className="pointer-events-none" />
      <div className="flex items-center gap-4 pr-16">
        <Tile
          tone="ink"
          className="size-[60px] rounded-[20px] [&_svg]:size-[26px]"
          icon={Icon}
        />
        <h2 className="text-[2.5rem] leading-none font-medium tracking-[-0.02em]">
          {name}
        </h2>
      </div>
      <p className="text-brand-foreground/65 -mt-2 max-w-[520px] text-base leading-snug font-medium text-pretty sm:min-h-[45px]">
        {tagline}
      </p>

      <dl className="grid grid-cols-3 rounded-[30px] bg-white/55 px-4 py-6 sm:px-7 sm:py-[30px]">
        {stats.map(({ label, value, loading }, index) => (
          <div
            key={label}
            className={
              index > 0
                ? "min-w-0 border-l border-black/10 pl-4 sm:pl-7"
                : "min-w-0"
            }
          >
            <dd className="text-5xl leading-none tracking-[-0.03em] tabular-nums sm:text-[4.75rem]">
              {loading ? (
                <Skeleton className="h-12 w-16 bg-black/10 sm:h-[4.75rem]" />
              ) : (
                (value ?? "—")
              )}
            </dd>
            <dt className="text-brand-foreground/65 mt-2 text-sm font-semibold sm:text-[0.9375rem]">
              {label}
            </dt>
          </div>
        ))}
      </dl>

      <div>
        <div className="text-brand-foreground/55 mb-3 text-[12.5px] font-bold tracking-[0.08em] uppercase">
          Inside
        </div>
        <div className="flex flex-wrap gap-2">
          {inside.map(({ href, label, Icon: ItemIcon }) => (
            <Link
              key={href}
              href={href}
              className="focus-visible:ring-brand-foreground/40 relative z-2 inline-flex h-11 items-center gap-[9px] rounded-full bg-white/55 pr-[18px] pl-3.5 text-[0.9rem] font-semibold outline-none transition-colors hover:bg-white/75 focus-visible:ring-3 [&_svg]:size-4"
            >
              <ItemIcon />
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-auto">
        <Button
          asChild
          size="lg"
          className="h-[58px] gap-[18px] pr-3 pl-7 text-base after:absolute after:inset-0 after:z-1 after:rounded-[44px]"
        >
          <Link href={path}>
            Open {name}
            <span className="bg-brand text-brand-foreground grid size-[38px] place-items-center rounded-full">
              <ArrowRight className="size-[18px]" />
            </span>
          </Link>
        </Button>
      </div>
    </Card>
  );
}

const TOOLS: {
  page: string;
  title: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
  soon?: boolean;
}[] = [
  {
    page: "calendar",
    title: "Calendar",
    description:
      "Interviews, client calls and team meetings in one place. Drag across empty time to schedule.",
    Icon: CalendarDays,
  },
  {
    page: "maintenance",
    title: "Job Maintenance",
    description:
      "Contracts you have won and roles you have started, with recurring meetings and prep notes.",
    Icon: Wrench,
  },
  {
    page: "interview",
    title: "Interview Assist",
    description:
      "Preparation notes, question banks and live assistance for every call and interview loop.",
    Icon: MessageSquareText,
    soon: true,
  },
];

/** The tools both portals share, each opening inside the portal you pick. */
function SharedTools() {
  return (
    <section className="space-y-[18px]">
      <SectionHead
        title="Shared tools"
        count="Opens inside the portal you pick"
      />
      <div className="grid gap-5 md:grid-cols-3">
        {TOOLS.map(({ page, title, description, Icon, soon }) => (
          <Card key={page} className="gap-[18px] rounded-[36px] p-[26px]">
            <div className="flex items-center justify-between">
              <Tile
                icon={Icon}
                size="lg"
                className="size-[52px] rounded-[18px]"
              />
              {soon && <Badge variant="outline">Coming soon</Badge>}
            </div>
            <div>
              <h3 className="text-2xl font-medium tracking-tight">{title}</h3>
              <p className="text-muted-foreground mt-1.5 text-[0.9rem] leading-relaxed font-medium">
                {description}
              </p>
            </div>
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              {PORTAL_IDS.map((id) => (
                <Link
                  key={id}
                  href={portalPath(id, page)}
                  data-portal={id}
                  className="bg-soft focus-visible:ring-ring/40 hover:bg-soft-2 inline-flex h-[42px] min-w-36 flex-1 items-center justify-between gap-2 rounded-full pr-4 pl-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3"
                >
                  <span className="flex items-center gap-[9px]">
                    <span
                      aria-hidden
                      className="bg-brand size-2.5 rounded-full"
                    />
                    {PORTALS[id].name}
                  </span>
                  <ArrowUpRight className="text-muted-foreground size-[15px]" />
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
