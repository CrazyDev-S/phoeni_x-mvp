"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FilePlus2, FileText, Sparkles, Video } from "lucide-react";
import Link from "next/link";

import { PageHero } from "@/components/page-hero";
import { Panel, PanelHead } from "@/components/panel";
import {
  CLOSED_STATUSES,
  resumeHref,
  STATUS_LABEL,
  type ApplicationRow,
  type ResumeRef,
} from "@/components/remote/applications/shared";
import { CompanyMark } from "@/components/remote/applications/step-mark";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortal } from "@/hooks/use-portal";
import { request } from "@/lib/api";
import { formatDateTime, relative } from "@/lib/format";
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

const ACTIVE_STATUSES = new Set(["applied", "in_process", "offer"]);

const TAILORED_STATUS: Record<string, { label: string; tone: Tone }> = {
  needs_review: { label: "Needs review", tone: "warn" },
  final: { label: "Ready to send", tone: "ok" },
};

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

  const apps = applications.data?.items ?? [];
  const interviewing = apps.filter((a) => INTERVIEWING.has(a.status)).length;
  const interviewRate = apps.length ? Math.round((interviewing / apps.length) * 100) : null;
  const offers = apps.filter((a) => a.status === "offer" || a.status === "hired").length;

  return (
    <div className="space-y-3">
      <PageHero
        title="Overview"
        stats={
          applications.isLoading || resumes.isLoading || tailored.isLoading
            ? undefined
            : [
                { value: resumes.data?.total ?? 0, label: "Resumes" },
                { value: tailored.data?.total ?? 0, label: "Tailored" },
                { value: applications.data?.total ?? 0, label: "Applications" },
                { value: interviewing, label: "Interviewing" },
                { value: offers, label: offers === 1 ? "Offer" : "Offers" },
                { value: interviewRate === null ? "-" : `${interviewRate}%`, label: "Interview rate" },
              ]
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/remote/resumes/new">
                <FilePlus2 />
                New resume
              </Link>
            </Button>
            <Button asChild variant="brand">
              <Link href="/remote/tailor">
                <Sparkles />
                Tailor a resume
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:items-start">
        <div className="min-w-0 space-y-3">
          <InMotion loading={applications.isLoading} applications={apps} />
          <LatestTailored
            loading={tailored.isLoading}
            rows={tailored.data?.items ?? []}
            total={tailored.data?.total ?? 0}
          />
        </div>
        <div className="min-w-0 space-y-3">
          {nextCall.data && <NextCall call={nextCall.data} applications={apps} />}
          <RecentResumes loading={resumes.isLoading} rows={resumes.data?.items ?? []} />
        </div>
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-1 p-2" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Button asChild variant="ghost" size="xs">
      <Link href={href}>View all</Link>
    </Button>
  );
}

// --- Applications in motion -----------------------------------------------------------

function InMotion({ loading, applications }: { loading: boolean; applications: ApplicationRow[] }) {
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
    })
    .slice(0, 8);

  return (
    <Panel>
      <PanelHead title="Applications in motion" count={active.length}>
        <ViewAll href="/remote/applications" />
      </PanelHead>
      {loading ? (
        <TableSkeleton />
      ) : !active.length ? (
        <p className="text-muted-foreground px-3 py-4 text-xs">No active applications.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Application</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead>Step</TableHead>
              <TableHead className="w-44">Next call</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="w-full max-w-0 min-w-56 py-1">
                  <Link
                    href={`/remote/applications/${a.id}`}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    <CompanyMark name={a.company_name} />
                    <span className="max-w-[16rem] min-w-16 shrink-[2] truncate font-semibold">{a.company_name}</span>
                    <span className="text-muted-foreground truncate text-xs">{a.role_title}</span>
                  </Link>
                </TableCell>
                <TableCell className="py-1">
                  <Badge variant="secondary">{STATUS_LABEL[a.status] ?? a.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground w-40 max-w-40 truncate py-1 text-xs">
                  {a.current_stage?.name ?? "-"}
                </TableCell>
                <TableCell className="py-1 text-xs tabular-nums">
                  {a.next_meeting ? (
                    <span className="flex items-center gap-1.5">
                      {formatDateTime(a.next_meeting.starts_at, "d MMM, h:mm a")}
                      {a.next_meeting.conferencing_url && (
                        <a
                          href={a.next_meeting.conferencing_url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Join the call with ${a.company_name}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Video className="size-3.5" />
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-subtle">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

// --- Latest tailored -----------------------------------------------------------------

function LatestTailored({
  loading,
  rows,
  total,
}: {
  loading: boolean;
  rows: TailoredRow[];
  total: number;
}) {
  const shown = rows.slice(0, 6);

  return (
    <Panel>
      <PanelHead title="Latest tailored" count={total}>
        <ViewAll href="/remote/resumes" />
      </PanelHead>
      {loading ? (
        <TableSkeleton />
      ) : !shown.length ? (
        <p className="text-muted-foreground px-3 py-4 text-xs">No tailored resumes yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Resume</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-20 text-right">Coverage</TableHead>
              <TableHead className="w-24">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((t) => {
              const status = TAILORED_STATUS[t.status];
              return (
                <TableRow key={t.id}>
                  <TableCell className="max-w-0 py-1">
                    <Link
                      href={`/remote/resumes/tailored/${t.id}`}
                      className="flex min-w-0 items-center gap-2 hover:underline"
                    >
                      <span className="min-w-0 truncate font-semibold">{t.job_title ?? t.display_name}</span>
                      {t.company_name && (
                        <span className="text-muted-foreground max-w-40 shrink-0 truncate text-xs">{t.company_name}</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="py-1">
                    {status ? (
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    ) : (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-1 text-right font-medium tabular-nums">
                    {t.must_have_coverage_percent != null ? (
                      `${Math.round(t.must_have_coverage_percent)}%`
                    ) : (
                      <span className="text-subtle">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground py-1 text-xs tabular-nums">
                    {formatDateTime(t.created_at, "d MMM")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

// --- Recent resumes ------------------------------------------------------------------

function RecentResumes({ loading, rows }: { loading: boolean; rows: ResumeRow[] }) {
  return (
    <Panel>
      <PanelHead title="Base resumes" count={rows.length}>
        <ViewAll href="/remote/resumes" />
      </PanelHead>
      {loading ? (
        <TableSkeleton rows={3} />
      ) : !rows.length ? (
        <p className="text-muted-foreground px-3 py-4 text-xs">No resumes yet.</p>
      ) : (
        <ul className="divide-y">
          {rows.slice(0, 6).map((r) => (
            <li key={r.id}>
              <Link
                href={`/remote/resumes/${r.id}`}
                className="hover:bg-muted/50 flex min-w-0 items-center gap-2 px-3 py-1.5"
              >
                <FileText className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{r.display_name}</span>
                <span className="text-muted-foreground max-w-[35%] shrink-[2] truncate text-xs">{r.target_title}</span>
                <time
                  dateTime={r.created_at}
                  className="text-subtle w-12 shrink-0 text-right text-xs tabular-nums"
                >
                  {formatDateTime(r.created_at, "d MMM")}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// --- Next call ---------------------------------------------------------------------------

/** The next call, with the prep the linked application actually holds. */
function NextCall({ call, applications }: { call: Upcoming; applications: ApplicationRow[] }) {
  const application = applications.find((a) => a.next_meeting?.id === call.meeting.id);
  const notes = application?.next_meeting?.preparation_notes?.trim() || null;
  const agenda = application?.next_meeting?.agenda?.trim() || null;
  const resume: ResumeRef | null = application?.tailored_resume_id
    ? { kind: "tailored", id: application.tailored_resume_id }
    : application?.base_resume_id
      ? { kind: "base", id: application.base_resume_id }
      : null;
  const postingUrl = application?.job_url ?? null;
  const joinUrl = call.meeting.conferencing_url;

  return (
    <Panel>
      <PanelHead title="Next call">
        <Link href="/remote/calendar" className="text-muted-foreground hover:text-foreground text-xs">
          Calendar
        </Link>
      </PanelHead>
      <div className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{call.meeting.title}</p>
            {call.company_name && (
              <p className="text-muted-foreground truncate text-xs">
                {call.company_name}
                {call.stage_name && ` · ${call.stage_name}`}
              </p>
            )}
            <p className="mt-0.5 text-xs tabular-nums">
              {formatDateTime(call.meeting.starts_at, "EEE d MMM, h:mm a")}{" "}
              <span className="text-muted-foreground">{relative(call.starts_in_minutes)}</span>
            </p>
          </div>
          {joinUrl && (
            <Button asChild variant="brand" size="sm" className="shrink-0">
              <a href={joinUrl} target="_blank" rel="noreferrer">
                <Video />
                Join
              </a>
            </Button>
          )}
        </div>

        {(resume || postingUrl) && (
          <div className="flex flex-wrap gap-1.5">
            {resume && (
              <Button asChild variant="outline" size="xs">
                <Link href={resumeHref(resume)}>
                  <FileText />
                  {resume.kind === "tailored" ? "Tailored resume" : "Resume"}
                </Link>
              </Button>
            )}
            {postingUrl && (
              <Button asChild variant="outline" size="xs">
                <a href={postingUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Posting
                </a>
              </Button>
            )}
          </div>
        )}

        {(notes || agenda) && (
          <div className="bg-muted/60 space-y-2 rounded-md p-2 text-xs">
            {notes && (
              <div>
                <p className="font-semibold">Prep notes</p>
                <p className="text-foreground/80 whitespace-pre-line">{notes}</p>
              </div>
            )}
            {agenda && (
              <div>
                <p className="font-semibold">Agenda</p>
                <p className="text-foreground/80 whitespace-pre-line">{agenda}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
