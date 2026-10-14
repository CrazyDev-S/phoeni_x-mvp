"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  CalendarClock,
  CalendarPlus,
  Check,
  ExternalLink,
  FilePlus2,
  FileText,
  Lightbulb,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Target,
  Video,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useState, type ComponentType, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHero } from "@/components/page-hero";
import { CLOSED_STATUSES, STATUS_LABEL, type ApplicationRow } from "@/components/remote/applications/shared";
import { HowItWorks } from "@/components/shared/how-it-works";
import { CheckList, SidePanel } from "@/components/side-panel";
import { SectionHead } from "@/components/section-head";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip, ChipRow } from "@/components/ui/chip";
import { CardLink, Notch } from "@/components/ui/notch";
import { Ring } from "@/components/ui/ring";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortal } from "@/hooks/use-portal";
import { request } from "@/lib/api";
import { formatDateTime, formatDay, relative } from "@/lib/format";
import type { Upcoming } from "@/components/shared/next-call";

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
  status: string;
  must_have_coverage_percent: number | null;
  created_at: string;
}

/** Reached a real conversation, as opposed to sitting in a queue. */
const INTERVIEWING = new Set(["in_process", "offer", "hired"]);

export default function RemoteOverviewPage() {
  const resumes = useQuery({
    queryKey: ["resumes", ""],
    queryFn: () => request<Page<ResumeRow>>("/api/v1/remote/resumes"),
  });
  const tailored = useQuery({
    queryKey: ["tailored-resumes"],
    queryFn: () => request<Page<TailoredRow>>("/api/v1/remote/tailored-resumes?limit=50"),
  });
  const applications = useQuery({
    queryKey: ["applications", "all"],
    queryFn: () => request<Page<ApplicationRow>>("/api/v1/remote/applications"),
  });
  // The same query the next-call banner and the top bar share, so no extra request.
  const portal = usePortal();
  const nextCall = useQuery({
    queryKey: ["next-call", portal],
    queryFn: () =>
      request<Upcoming | null>(
        `/api/v1/shared/meetings/next${portal ? `?category=${portal}` : ""}`,
      ),
    refetchInterval: 60_000,
  });

  const loading = resumes.isLoading || tailored.isLoading || applications.isLoading;
  const apps = applications.data?.items ?? [];
  const interviewing = apps.filter((a) => INTERVIEWING.has(a.status)).length;
  const interviewRate = apps.length ? Math.round((interviewing / apps.length) * 100) : null;

  return (
    <div className="space-y-7">
      <PageHero
        title="Overview"
        stats={[
          { value: resumes.isLoading ? "…" : (resumes.data?.total ?? 0), label: "Resumes" },
          { value: tailored.isLoading ? "…" : (tailored.data?.total ?? 0), label: "Tailored" },
          { value: applications.isLoading ? "…" : (applications.data?.total ?? 0), label: "Applied" },
          { value: interviewRate === null ? "—" : `${interviewRate}%`, label: "Interview rate" },
        ]}
        actions={
          <>
            <Button asChild variant="secondary" size="lg">
              <Link href="/remote/resumes/new">
                <FilePlus2 />
                New resume
              </Link>
            </Button>
            <Button asChild variant="brand" size="lg">
              <Link href="/remote/tailor">
                <Sparkles />
                Tailor a resume
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          <LatestTailored
            loading={tailored.isLoading}
            rows={tailored.data?.items ?? []}
            total={tailored.data?.total ?? 0}
          />
          <InMotion loading={applications.isLoading} applications={apps} />
          <RecentActivity
            loading={loading}
            resumes={resumes.data?.items ?? []}
            tailored={tailored.data?.items ?? []}
            applications={apps}
          />
        </div>

        <aside className="space-y-5">
          {nextCall.data && <NextCallPrep call={nextCall.data} applications={apps} />}
          <RecommendedActions
            hasResume={Boolean(resumes.data?.total)}
            hasTailored={Boolean(tailored.data?.total)}
            hasApplication={Boolean(applications.data?.total)}
          />
          <SidePanel icon={Lightbulb} title="Get more out of it">
            <CheckList items={HOME_TIPS} />
          </SidePanel>
          <HowItWorks
            title="How Remote works"
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

function CardSkeletons({ height }: { height: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className={`${height} rounded-[2rem]`} />
      ))}
    </div>
  );
}

// --- Latest tailored -----------------------------------------------------------------

type TailoredFilter = "all" | "needs_review" | "final";

function LatestTailored({
  loading,
  rows,
  total,
}: {
  loading: boolean;
  rows: TailoredRow[];
  total: number;
}) {
  const [filter, setFilter] = useState<TailoredFilter>("all");
  const shown = rows.filter((r) => filter === "all" || r.status === filter).slice(0, 3);

  return (
    <section className="space-y-4">
      <SectionHead title="Latest tailored" count={`${total} ${total === 1 ? "resume" : "resumes"}`}>
        {total > 0 && (
          <ChipRow>
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </Chip>
            <Chip active={filter === "needs_review"} onClick={() => setFilter("needs_review")}>
              Needs review
            </Chip>
            <Chip active={filter === "final"} onClick={() => setFilter("final")}>
              Ready to send
            </Chip>
          </ChipRow>
        )}
      </SectionHead>

      {loading ? (
        <CardSkeletons height="h-[17rem]" />
      ) : !rows.length ? (
        <Card tone="soft" className="gap-0 py-0">
          <EmptyState
            icon={<Sparkles />}
            title="No tailored resumes yet"
            description="Paste a posting and get a version of your resume written for it."
            action={
              <Button asChild>
                <Link href="/remote/tailor">Tailor a resume</Link>
              </Button>
            }
          />
        </Card>
      ) : !shown.length ? (
        <p className="text-muted-foreground px-1 text-sm font-medium">
          Nothing matches this filter among your latest tailored resumes.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <TailoredCard key={t.id} row={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function TailoredCard({ row }: { row: TailoredRow }) {
  const heading = row.job_title ?? row.display_name;
  const initial = (row.company_name ?? row.display_name).trim().charAt(0).toUpperCase() || "R";
  const coverage = row.must_have_coverage_percent;
  const status =
    row.status === "needs_review"
      ? { label: "Needs review", variant: "warning" as const }
      : row.status === "final"
        ? { label: "Ready to send", variant: "success" as const }
        : { label: "Draft", variant: "secondary" as const };

  return (
    <Card tone="soft" className="gap-0 p-[22px]">
      <Notch>
        <ArrowUpRight className="size-[18px]" />
      </Notch>
      <Tile tone="brand" size="lg" className="mb-5 font-extrabold text-lg">
        {initial}
      </Tile>
      <CardLink
        href={`/remote/resumes/tailored/${row.id}`}
        className="block pr-2 text-xl leading-tight font-semibold tracking-tight"
      >
        {heading}
      </CardLink>
      <p className="text-muted-foreground mt-1 truncate text-sm font-medium">
        {row.company_name ?? row.display_name}
      </p>
      <div className="mt-5 flex items-center gap-3.5">
        {coverage != null ? (
          <Ring value={coverage} size={56} className="[--ring-bg:var(--soft)]" />
        ) : (
          <span className="bg-soft-2 text-muted-foreground grid size-14 place-items-center rounded-full text-xs font-bold">
            n/a
          </span>
        )}
        <div className="min-w-0">
          <p className="font-bold">Must-have coverage</p>
          <p className="text-muted-foreground text-sm font-medium">
            {coverage != null ? `${Math.round(coverage)}% of the posting's must-haves` : "Not measured"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge variant={status.variant}>{status.label}</Badge>
        <Badge variant="outline">Added {formatDateTime(row.created_at, "d MMM")}</Badge>
      </div>
    </Card>
  );
}

// --- Applications in motion -----------------------------------------------------------

type MotionFilter = "all" | "today" | "interviewing" | "waiting";

const ACTIVE_STATUSES = new Set(["applied", "in_process", "offer"]);

function InMotion({ loading, applications }: { loading: boolean; applications: ApplicationRow[] }) {
  const [filter, setFilter] = useState<MotionFilter>("all");

  const today = formatDay(new Date().toISOString());
  const active = applications
    .filter((a) => ACTIVE_STATUSES.has(a.status) && !CLOSED_STATUSES.has(a.status))
    .sort((a, b) => {
      // A booked call outranks everything; sooner first. The rest: newest first.
      if (a.next_meeting && b.next_meeting) {
        return a.next_meeting.starts_at.localeCompare(b.next_meeting.starts_at);
      }
      if (a.next_meeting) return -1;
      if (b.next_meeting) return 1;
      return b.created_at.localeCompare(a.created_at);
    });

  const matches = (a: ApplicationRow) => {
    if (filter === "today") return a.next_meeting != null && formatDay(a.next_meeting.starts_at) === today;
    if (filter === "interviewing") return INTERVIEWING.has(a.status);
    if (filter === "waiting") return a.status === "applied";
    return true;
  };
  const shown = active.filter(matches).slice(0, 3);

  return (
    <section className="space-y-4">
      <SectionHead title="Applications in motion" count={`${active.length} active`}>
        {active.length > 0 && (
          <ChipRow>
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </Chip>
            <Chip active={filter === "today"} onClick={() => setFilter("today")}>
              Due today
            </Chip>
            <Chip active={filter === "interviewing"} onClick={() => setFilter("interviewing")}>
              Interviewing
            </Chip>
            <Chip active={filter === "waiting"} onClick={() => setFilter("waiting")}>
              Waiting
            </Chip>
          </ChipRow>
        )}
      </SectionHead>

      {loading ? (
        <CardSkeletons height="h-[16rem]" />
      ) : !active.length ? (
        <Card tone="soft" className="gap-0 py-0">
          <EmptyState
            icon={<Briefcase />}
            title="No applications in motion"
            description="Track an application and its stage, next call and prep notes stay in one place."
            action={
              <Button asChild>
                <Link href="/remote/applications">
                  <Plus />
                  Track an application
                </Link>
              </Button>
            }
          />
        </Card>
      ) : !shown.length ? (
        <p className="text-muted-foreground px-1 text-sm font-medium">
          No active application matches this filter.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((a, index) => (
            <MotionCard key={a.id} application={a} highlight={index === 0 && a.next_meeting != null} />
          ))}
        </div>
      )}
    </section>
  );
}

function MotionCard({ application: a, highlight }: { application: ApplicationRow; highlight: boolean }) {
  const meeting = a.next_meeting;
  const joinUrl = meeting?.conferencing_url ?? null;
  const Icon: ComponentType<{ className?: string }> = meeting
    ? joinUrl
      ? Video
      : CalendarClock
    : a.status === "applied"
      ? Send
      : Briefcase;
  const heading = a.current_stage?.name ?? STATUS_LABEL[a.status] ?? a.status.replace(/_/g, " ");
  const where = meeting ? (meeting.location ?? (joinUrl ? "Video call" : null)) : null;
  const detail = meeting
    ? [formatDateTime(meeting.starts_at, "d MMM, h:mm a"), where].filter(Boolean).join(" · ")
    : a.applied_at
      ? `Applied ${formatDateTime(a.applied_at, "d MMM")}`
      : `Added ${formatDateTime(a.created_at, "d MMM")}`;

  return (
    <Card
      tone={highlight ? "accent" : "default"}
      className={highlight ? "gap-0 rounded-bl-[3.5rem] p-[22px]" : "gap-0 p-[22px]"}
    >
      <Notch tone={highlight ? "dark" : "light"}>
        <ArrowUpRight className="size-[18px]" />
      </Notch>
      <div className="flex items-center gap-3 pr-16">
        <span
          className={
            highlight
              ? "bg-panel text-panel-foreground grid size-12 shrink-0 place-items-center rounded-full text-base font-bold"
              : "bg-soft-2 text-foreground grid size-12 shrink-0 place-items-center rounded-full text-base font-bold"
          }
        >
          {a.company_name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{a.company_name}</p>
          <p className={highlight ? "truncate text-sm opacity-65" : "text-muted-foreground truncate text-sm"}>
            {a.role_title}
          </p>
        </div>
      </div>
      <div className="mt-7 flex items-center gap-3">
        <Tile tone={highlight ? "ink" : "soft"} size="lg">
          <Icon />
        </Tile>
        <CardLink
          href="/remote/applications"
          className="text-2xl leading-[1.1] font-semibold tracking-tight text-balance"
        >
          {heading}
        </CardLink>
      </div>
      <p className={highlight ? "mt-2.5 text-sm opacity-65" : "text-muted-foreground mt-2.5 text-sm"}>
        {detail}
      </p>
      <div className="relative z-10 mt-5 flex items-center gap-3">
        <span
          className={
            highlight
              ? "bg-card text-foreground flex h-12 flex-1 items-center rounded-full px-5 text-sm font-semibold"
              : "border-foreground/15 flex h-12 flex-1 items-center rounded-full border-[1.5px] px-5 text-sm font-semibold"
          }
        >
          {STATUS_LABEL[a.status] ?? a.status.replace(/_/g, " ")}
        </span>
        {joinUrl && (
          <a
            href={joinUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Join the ${heading} call with ${a.company_name}`}
            className="bg-primary text-primary-foreground hover:bg-primary/85 grid size-12 shrink-0 place-items-center rounded-full transition-colors"
          >
            <Video className="size-[18px]" />
          </a>
        )}
      </div>
    </Card>
  );
}

// --- Recent activity -------------------------------------------------------------------

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
      href: `/remote/resumes/${r.id}`,
      tone: (r.status === "needs_review" ? "warn" : "neutral") as Tone,
      status: r.status === "needs_review" ? "Needs review" : "Ready",
    })),
    ...tailored.map((t) => ({
      key: `t-${t.id}`,
      at: t.created_at,
      Icon: Sparkles,
      title: "Resume tailored",
      detail: [t.company_name, t.job_title].filter(Boolean).join(" · ") || t.display_name,
      href: `/remote/resumes/tailored/${t.id}`,
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
      href: "/remote/applications",
      tone: "neutral" as Tone,
      // The same words the status select uses, rather than a title-cased enum.
      status: STATUS_LABEL[a.status] ?? a.status.replace(/_/g, " "),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return (
    <section className="space-y-4">
      <SectionHead title="Recent activity">
        <Button asChild variant="outline" size="xs">
          <Link href="/remote/applications">
            View all
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </SectionHead>

      <Card className="gap-0 py-1.5">
        <CardContent>
          {loading ? (
            <div className="space-y-4 py-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-11 rounded-[14px]" />
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
                  <Link href="/remote/resumes/new">
                    <Plus />
                    Create a resume
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-border divide-y">
              {activity.map(({ key, Icon, title, detail, href, at, tone, status }) => (
                <li key={key} className="relative flex items-center gap-3.5 py-3.5">
                  <Tile icon={Icon} />
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="font-semibold after:absolute after:inset-0">
                      {title}
                    </Link>
                    <p className="text-muted-foreground truncate text-sm font-medium">{detail}</p>
                  </div>
                  <StatusBadge tone={tone} className="shrink-0">
                    {status}
                  </StatusBadge>
                  <time
                    dateTime={at}
                    className="text-muted-foreground hidden w-14 shrink-0 text-right text-sm font-medium tabular-nums sm:block"
                  >
                    {formatDateTime(at, "d MMM")}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// --- Next call prep ----------------------------------------------------------------------

/** The next call, with the prep the linked application actually holds. */
function NextCallPrep({ call, applications }: { call: Upcoming; applications: ApplicationRow[] }) {
  const application = applications.find((a) => a.next_meeting?.id === call.meeting.id);
  const notes = application?.next_meeting?.preparation_notes?.trim() || null;
  const agenda = application?.next_meeting?.agenda?.trim() || null;
  const resumeId = application?.tailored_resume_id ?? null;
  const postingUrl = application?.job_url ?? null;
  const joinUrl = call.meeting.conferencing_url;
  const hasDocuments = Boolean(resumeId || postingUrl);

  return (
    <Card tone="dark" className="gap-0 rounded-[2.25rem] p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-panel-raised grid size-10 shrink-0 place-items-center rounded-full">
            <WandSparkles className="size-[18px]" />
          </span>
          <h2 className="text-2xl font-medium tracking-tight">Next call prep</h2>
        </div>
        <Link
          href="/remote/calendar"
          aria-label="Open the calendar"
          className="bg-panel-raised hover:bg-panel-raised/80 grid size-10 shrink-0 place-items-center rounded-full transition-colors"
        >
          <ArrowUpRight className="size-[18px]" />
        </Link>
      </div>

      <ol className="before:bg-panel-raised relative space-y-3 pl-9 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px">
        <TimelineItem icon={Video} active>
          <p className="text-[1.0625rem] font-semibold">{call.meeting.title}</p>
          {call.company_name && (
            <p className="text-panel-muted text-sm">
              {call.company_name}
              {call.stage_name && ` · ${call.stage_name}`}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-panel-muted text-sm tabular-nums">
              {formatDateTime(call.meeting.starts_at, "EEE d MMM, h:mm a")} ·{" "}
              <span className="text-panel-foreground font-semibold">{relative(call.starts_in_minutes)}</span>
            </p>
            {joinUrl && (
              <Button asChild variant="brand" size="sm" className="shrink-0">
                <a href={joinUrl} target="_blank" rel="noreferrer">
                  <Video />
                  Join
                </a>
              </Button>
            )}
          </div>
        </TimelineItem>

        {hasDocuments && (
          <TimelineItem icon={FileText}>
            <p className="mb-3 text-[1.0625rem] font-semibold">Documents:</p>
            <div className="grid grid-cols-2 gap-3">
              {resumeId && (
                <Link
                  href={`/remote/resumes/tailored/${resumeId}`}
                  className="bg-panel hover:bg-panel/70 flex h-24 flex-col justify-between rounded-2xl p-3 transition-colors"
                >
                  <FileText className="text-panel-muted size-5" />
                  <span className="text-sm font-semibold">Tailored resume</span>
                </Link>
              )}
              {postingUrl && (
                <a
                  href={postingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-panel hover:bg-panel/70 flex h-24 flex-col justify-between rounded-2xl p-3 transition-colors"
                >
                  <ExternalLink className="text-panel-muted size-5" />
                  <span className="text-sm font-semibold">Posting</span>
                </a>
              )}
            </div>
          </TimelineItem>
        )}

        {(notes || agenda) && (
          <TimelineItem icon={Target} active>
            <div className="bg-soft text-foreground -m-[18px] space-y-3 rounded-3xl p-[18px]">
              {notes && (
                <div>
                  <p className="mb-1.5 text-[1.0625rem] font-semibold">Prep notes:</p>
                  <p className="text-foreground/75 text-sm leading-relaxed whitespace-pre-line">{notes}</p>
                </div>
              )}
              {agenda && (
                <div>
                  <p className="mb-1.5 text-[1.0625rem] font-semibold">Agenda:</p>
                  <p className="text-foreground/75 text-sm leading-relaxed whitespace-pre-line">{agenda}</p>
                </div>
              )}
            </div>
          </TimelineItem>
        )}
      </ol>
    </Card>
  );
}

function TimelineItem({
  icon: Icon,
  active = false,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="bg-panel-raised relative rounded-3xl p-[18px]">
      <span
        className={
          active
            ? "bg-brand text-brand-foreground absolute top-4 -left-9 grid size-6 place-items-center rounded-full"
            : "bg-panel-raised text-panel-muted absolute top-4 -left-9 grid size-6 place-items-center rounded-full"
        }
      >
        <Icon className="size-3" />
      </span>
      {children}
    </li>
  );
}

// --- Do next ------------------------------------------------------------------------------

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
      href: "/remote/resumes/new",
      Icon: Plus,
      title: "Add a base resume",
      detail: "Paste one you already have, or generate one.",
      done: hasResume,
    },
    {
      href: "/remote/tailor",
      Icon: Target,
      title: "Tailor it to a job",
      detail: "Paste a posting and get a version written for it.",
      done: hasTailored,
    },
    {
      href: "/remote/applications",
      Icon: Briefcase,
      title: "Track an application",
      detail: "Keep the stage and the next call in one place.",
      done: hasApplication,
    },
    {
      href: "/remote/calendar",
      Icon: CalendarPlus,
      title: "Schedule your next call",
      detail: "Every stage can carry its own prep notes.",
      done: false,
    },
  ];
  const left = actions.filter((a) => !a.done).length;

  return (
    <Card className="gap-0 p-6">
      <CardHeader className="mb-4 flex flex-row items-center justify-between space-y-0 px-0">
        <CardTitle>Do next</CardTitle>
        <span className="text-muted-foreground border-foreground border-b-[1.5px] pb-px text-[13px] font-semibold">
          {left} left
        </span>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="space-y-3.5">
          {actions.map(({ href, title, detail, done }) => (
            <li key={href} className="relative flex items-start gap-3">
              <span
                aria-hidden
                className={
                  done
                    ? "bg-primary text-brand mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-lg"
                    : "border-foreground/25 mt-0.5 size-[22px] shrink-0 rounded-lg border-[1.8px]"
                }
              >
                {done && <Check className="size-3.5 stroke-[3]" />}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={href}
                  className={
                    done
                      ? "text-muted-foreground font-semibold line-through after:absolute after:inset-0"
                      : "font-semibold after:absolute after:inset-0"
                  }
                >
                  {title}
                  {done && <span className="sr-only"> (done)</span>}
                </Link>
                {!done && <p className="text-muted-foreground mt-0.5 text-xs font-medium">{detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
