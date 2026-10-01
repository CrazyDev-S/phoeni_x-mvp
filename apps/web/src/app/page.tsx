"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  LayoutGrid,
  MessageSquareText,
  Search,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { PageHero } from "@/components/page-hero";
import { NextCallBanner } from "@/components/shared/next-call";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { request } from "@/lib/api";

interface Page {
  total: number;
}

/** GET /api/v1/freelancing/tracks/summary: one count per track status. */
interface TrackSummary {
  focused: number;
  proposal_drafted: number;
  submitted: number;
  viewed: number;
  interviewing: number;
  hired: number;
  declined: number;
  withdrawn: number;
  closed: number;
  total: number;
}

/**
 * The workspace launcher.
 *
 * Two categories side by side, each with the three numbers that say how much
 * is in flight there, and the tools that serve both underneath.
 */
export default function HomePage() {
  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Workspace"
        eyebrowIcon={LayoutGrid}
        title={
          <>
            Welcome to <span className="text-gradient-brand">PhoeniX</span>
          </>
        }
        description="Two ways to find work, one place to run it all: bid on freelancing jobs, land remote roles, and keep every call on one calendar."
      />

      <NextCallBanner />

      <section className="grid gap-4 lg:grid-cols-2">
        <FreelancingCard />
        <RemoteCard />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Shared tools</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            The same calendar, interview help and job upkeep, whichever way you found the work.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <ToolCard
            href="/calendar"
            Icon={CalendarDays}
            title="Calendar"
            description="Every interview and standing meeting, across both categories."
          />
          <ToolCard
            href="/interview"
            Icon={MessageSquareText}
            title="Interview Assist"
            description="Prep notes, question banks and live assist. Coming soon."
            badge={<StatusBadge tone="warn">Soon</StatusBadge>}
          />
          <ToolCard
            href="/maintenance"
            Icon={Wrench}
            title="Job Maintenance"
            description="Standing meetings and notes for the jobs you have won."
          />
        </div>
      </section>
    </div>
  );
}

function FreelancingCard() {
  // The Freelancing API may not be reachable yet; a dash is the honest answer,
  // not an error banner on the home page.
  const summary = useQuery({
    queryKey: ["freelancing", "tracks", "summary"],
    queryFn: () => request<TrackSummary>("/api/v1/freelancing/tracks/summary"),
    retry: false,
  });

  return (
    <CategoryCard
      href="/freelancing"
      Icon={Search}
      title="Freelancing"
      description="Search Upwork with every filter, focus the jobs worth bidding on, and track each proposal."
      cta="Open Freelancing"
      stats={[
        { label: "Focused", value: summary.data?.focused, loading: summary.isLoading },
        { label: "Submitted", value: summary.data?.submitted, loading: summary.isLoading },
        { label: "Interviewing", value: summary.data?.interviewing, loading: summary.isLoading },
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
    <CategoryCard
      href="/remote"
      Icon={Briefcase}
      title="Remote"
      description="Tailor a resume to each posting, apply from the browser, and follow the interview loop."
      cta="Open Remote"
      stats={[
        { label: "Resumes", value: resumes.data?.total, loading: resumes.isLoading },
        { label: "Tailored", value: tailored.data?.total, loading: tailored.isLoading },
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

/** One category: what it is, how much is in flight there, and the way in. */
function CategoryCard({
  href,
  Icon,
  title,
  description,
  cta,
  stats,
}: {
  href: string;
  Icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  cta: string;
  stats: Stat[];
}) {
  return (
    <Card className="relative gap-0 py-0 transition-shadow duration-200 hover:shadow-sm">
      <span aria-hidden className="bg-gradient-brand absolute inset-x-0 top-0 h-1" />
      <CardContent className="flex h-full flex-col gap-5 p-6">
        <div className="flex items-start gap-4">
          <span className="bg-accent text-accent-foreground flex size-12 shrink-0 items-center justify-center rounded-xl">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            <p className="text-muted-foreground mt-1 text-sm text-pretty">{description}</p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t pt-4">
          {stats.map(({ label, value, loading }) => (
            <div key={label} className="min-w-0">
              {loading ? (
                <Skeleton className="h-7 w-10" />
              ) : (
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {value ?? "—"}
                </dd>
              )}
              <dt className="text-muted-foreground mt-0.5 truncate text-xs">{label}</dt>
            </div>
          ))}
        </dl>

        <Button asChild variant="brand" className="mt-auto w-fit">
          <Link href={href}>
            {cta}
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** A compact row-card: the whole thing is the link. */
function ToolCard({
  href,
  Icon,
  title,
  description,
  badge,
}: {
  href: string;
  Icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge?: ReactNode;
}) {
  return (
    <Card className="hover:bg-muted/40 relative gap-0 py-0 transition-colors">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={href} className="text-sm font-medium after:absolute after:inset-0">
              {title}
            </Link>
            {badge}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{description}</p>
        </div>
        <ArrowRight className="text-subtle mt-1 size-4 shrink-0" />
      </CardContent>
    </Card>
  );
}
