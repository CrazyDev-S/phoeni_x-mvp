"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  CalendarPlus,
  CheckCircle2,
  FileText,
  MessageSquare,
  Plus,
  Lightbulb,
  ListChecks,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { STATUS_LABEL } from "@/components/applications/shared";
import { EmptyState } from "@/components/empty-state";
import { PageHero } from "@/components/page-hero";
import { CheckList, SidePanel } from "@/components/side-panel";
import { StepsBand } from "@/components/steps-band";
import { NextCallBanner } from "@/components/next-call";
import { StatCard } from "@/components/stat-card";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { request } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface Page<T> {
  items: T[];
  total: number;
}

interface ResumeRow {
  id: string;
  display_name: string;
  target_title: string;
  status: string;
  created_at: string;
}

interface TailoredRow {
  id: string;
  display_name: string;
  company_name: string | null;
  job_title: string | null;
  must_have_coverage_percent: number | null;
  created_at: string;
}

interface ApplicationRow {
  id: string;
  company_name: string;
  role_title: string;
  status: string;
  created_at: string;
}

/** Reached a real conversation, as opposed to sitting in a queue. */
const INTERVIEWING = new Set(["in_process", "offer", "hired"]);

export default function HomePage() {
  const resumes = useQuery({
    queryKey: ["resumes", ""],
    queryFn: () => request<Page<ResumeRow>>("/api/v1/resumes"),
  });
  const tailored = useQuery({
    queryKey: ["tailored-resumes"],
    queryFn: () => request<Page<TailoredRow>>("/api/v1/tailored-resumes?limit=50"),
  });
  const applications = useQuery({
    queryKey: ["applications", "all"],
    queryFn: () => request<Page<ApplicationRow>>("/api/v1/applications"),
  });

  const loading = resumes.isLoading || tailored.isLoading || applications.isLoading;
  const apps = applications.data?.items ?? [];
  const interviewing = apps.filter((a) => INTERVIEWING.has(a.status)).length;
  const interviewRate = apps.length ? Math.round((interviewing / apps.length) * 100) : null;

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="AI-Powered"
        eyebrowIcon={Sparkles}
        title={
          <>
            Land your next <span className="text-gradient-brand">opportunity</span>
          </>
        }
        description="Tailor your resume to every job with AI-powered insights."
        actions={
          <>
            <Button asChild variant="brand" size="lg" className="h-11">
              <Link href="/tailor">
                <Sparkles />
                Tailor a resume
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11">
              <Link href="/resumes">View resumes</Link>
            </Button>
          </>
        }
      />

      <NextCallBanner />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Resumes"
          Icon={FileText}
          loading={resumes.isLoading}
          value={resumes.data?.total ?? 0}
          hint="Base resumes you can tailor from"
        />
        <StatCard
          label="Tailored"
          Icon={Sparkles}
          tone="info"
          loading={tailored.isLoading}
          value={tailored.data?.total ?? 0}
          hint="Versions written against a posting"
        />
        <StatCard
          label="Applications"
          Icon={Briefcase}
          tone="warning"
          loading={applications.isLoading}
          value={applications.data?.total ?? 0}
          hint="Tracked from saved to offer"
        />
        <StatCard
          label="Interview rate"
          Icon={TrendingUp}
          tone="success"
          loading={applications.isLoading}
          value={interviewRate === null ? "—" : `${interviewRate}%`}
          hint={
            apps.length
              ? `${interviewing} of ${apps.length} reached a conversation`
              : "No applications tracked yet"
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <RecentActivity
            loading={loading}
            resumes={resumes.data?.items ?? []}
            tailored={tailored.data?.items ?? []}
            applications={apps}
          />

          <StepsBand
            title="How Phoenix Eye works"
            description="Three steps, from a blank page to a tracked application."
            steps={[
              {
                title: "Add a base resume",
                detail: "Paste one you already have, or generate one from a story.",
              },
              {
                title: "Tailor it to a posting",
                detail: "Every tailored version keeps its own coverage report.",
              },
              {
                title: "Apply and track it",
                detail: "Stages, the next call and prep notes stay in one place.",
              },
            ]}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <RecommendedActions
            hasResume={Boolean(resumes.data?.total)}
            hasTailored={Boolean(tailored.data?.total)}
            hasApplication={Boolean(applications.data?.total)}
          />
          <SidePanel icon={Lightbulb} title="Get more out of it">
            <CheckList items={HOME_TIPS} />
          </SidePanel>
        </aside>
      </div>
    </div>
  );
}

const HOME_TIPS = [
  "Keep one base resume per stack, not one per job.",
  "Paste the whole posting — coverage is counted from it.",
  "Mark a stage passed as soon as it happens; the next call follows.",
  "Check the ATS report before you send anything.",
];

interface Activity {
  key: string;
  at: string;
  Icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  href: string;
  tone: Tone;
  status: string;
}

function RecentActivity({
  loading,
  resumes,
  tailored,
  applications,
}: {
  loading: boolean;
  resumes: ResumeRow[];
  tailored: TailoredRow[];
  applications: ApplicationRow[];
}) {
  const activity: Activity[] = [
    ...resumes.map((r) => ({
      key: `r-${r.id}`,
      at: r.created_at,
      Icon: FileText,
      title: "Resume created",
      detail: r.display_name,
      href: `/resumes/${r.id}`,
      tone: (r.status === "needs_review" ? "warn" : "neutral") as Tone,
      status: r.status === "needs_review" ? "Needs review" : "Ready",
    })),
    ...tailored.map((t) => ({
      key: `t-${t.id}`,
      at: t.created_at,
      Icon: Sparkles,
      title: "Resume tailored",
      detail: [t.company_name, t.job_title].filter(Boolean).join(" · ") || t.display_name,
      href: `/resumes/tailored/${t.id}`,
      tone: "brand" as Tone,
      status:
        t.must_have_coverage_percent != null
          ? `${t.must_have_coverage_percent}% match`
          : "Tailored",
    })),
    ...applications.map((a) => ({
      key: `a-${a.id}`,
      at: a.created_at,
      Icon: Briefcase,
      title: "Application tracked",
      detail: `${a.company_name} · ${a.role_title}`,
      href: "/applications",
      tone: "neutral" as Tone,
      // The same words the status select uses, rather than a title-cased enum.
      status: STATUS_LABEL[a.status] ?? a.status.replace(/_/g, " "),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b py-4">
        <CardTitle className="text-base">Recent activity</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/applications">
            View all
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="px-0">
        {loading ? (
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            ))}
          </div>
        ) : !activity.length ? (
          <EmptyState
            icon={<MessageSquare />}
            title="Nothing has happened yet"
            description="Create a resume, then tailor it to a posting — the trail shows up here."
            action={
              <Button asChild>
                <Link href="/resumes/new">
                  <Plus />
                  Create a resume
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {activity.map(({ key, Icon, title, detail, href, at, tone, status }) => (
              <li key={key} className="hover:bg-muted/40 relative transition-colors">
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <span className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={href}
                      className="text-sm font-medium after:absolute after:inset-0"
                    >
                      {title}
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">{detail}</p>
                  </div>
                  <StatusBadge tone={tone} className="relative z-10 shrink-0">
                    {status}
                  </StatusBadge>
                  <time
                    dateTime={at}
                    className="text-subtle hidden shrink-0 text-xs tabular-nums sm:block"
                  >
                    {formatDateTime(at, "d MMM")}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendedActions({
  hasResume,
  hasTailored,
  hasApplication,
}: {
  hasResume: boolean;
  hasTailored: boolean;
  hasApplication: boolean;
}) {
  const actions = [
    {
      href: "/resumes/new",
      Icon: Plus,
      title: "Add a base resume",
      detail: "Paste one you already have, or generate one.",
      done: hasResume,
    },
    {
      href: "/tailor",
      Icon: Target,
      title: "Tailor it to a job",
      detail: "Paste a posting and get a version written for it.",
      done: hasTailored,
    },
    {
      href: "/applications",
      Icon: Briefcase,
      title: "Track an application",
      detail: "Keep the stage and the next call in one place.",
      done: hasApplication,
    },
    {
      href: "/calendar",
      Icon: CalendarPlus,
      title: "Schedule your next call",
      detail: "Every stage can carry its own prep notes.",
      done: false,
    },
  ];

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-center gap-2.5 space-y-0 border-b py-4">
        <span className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <ListChecks className="size-4" />
        </span>
        <CardTitle className="text-base">Recommended actions</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y">
          {actions.map(({ href, Icon, title, detail, done }) => (
            <li key={href} className="hover:bg-muted/40 relative transition-colors">
              <div className="flex items-start gap-3 px-5 py-3.5">
                <span
                  className={
                    done
                      ? "bg-success/10 text-success flex size-8 shrink-0 items-center justify-center rounded-lg"
                      : "bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
                  }
                >
                  {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={href}
                    className="text-sm font-medium after:absolute after:inset-0"
                  >
                    {title}
                  </Link>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                    {detail}
                  </p>
                </div>
                <ArrowRight className="text-subtle mt-1 size-4 shrink-0" />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
