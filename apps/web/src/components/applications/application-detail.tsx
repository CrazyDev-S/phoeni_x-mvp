"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  ListChecks,
  Maximize2,
  NotebookPen,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Video,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import { EditApplicationDialog } from "@/components/applications/edit-dialog";
import { StageMenu } from "@/components/applications/stage-menu";
import { StatusSelect } from "@/components/applications/status-select";
import { MeetingDialog, type MeetingDialogState } from "@/components/calendar/meeting-dialog";
import { ErrorAlert } from "@/components/error-alert";
import { GenerationProgress } from "@/components/generation-progress";
import { FactList } from "@/components/side-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useGeneration } from "@/hooks/use-generation";
import { downloadDocx, request } from "@/lib/api";
import type { Meeting } from "@/lib/calendar";
import { formatDateTime, relative } from "@/lib/format";
import { humanize, invalidateSchedule, meetingStatus } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import {
  CLOSED_STATUSES,
  currentStage,
  stageStatus,
  TONE_TINT,
  type ApplicationDetail,
  type StageUpdated,
  type TailoredResumeBrief,
} from "./shared";

type Layout = "sheet" | "page";

/**
 * One application, whole: the job link, the resume that was sent, the company,
 * and every interview step with its meetings.
 *
 * The same view backs the side sheet on the tracking table and the full page,
 * so the two can never show different facts. Only the arrangement differs.
 */
export function ApplicationDetailView({
  id,
  layout,
  onDeleted,
}: {
  id: string;
  layout: Layout;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<MeetingDialogState>(null);
  const [editing, setEditing] = useState(false);
  const [suggestion, setSuggestion] = useState<StageUpdated["suggested_next_stage"]>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["application", id],
    queryFn: () => request<ApplicationDetail>(`/api/v1/applications/${id}`),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<ApplicationDetail>(`/api/v1/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["application", id], updated);
      invalidateSchedule(queryClient);
    },
  });

  const setStage = useMutation({
    mutationFn: ({ stageId, status }: { stageId: string; status: string }) =>
      request<StageUpdated>(`/api/v1/stages/${stageId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (res) => {
      invalidateSchedule(queryClient);
      const next = res.suggested_next_stage;
      setSuggestion(next?.stage_id && !next.already_scheduled ? next : null);
    },
  });

  const remove = useMutation({
    mutationFn: () => request(`/api/v1/applications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["application", id] });
      invalidateSchedule(queryClient);
      onDeleted?.();
    },
  });

  if (error) {
    return (
      <ErrorAlert title="We couldn’t open that application.">
        {(error as Error).message}
      </ErrorAlert>
    );
  }
  if (isLoading || !data) return <DetailSkeleton layout={layout} />;

  const schedule = (stageId?: string, duration?: number) =>
    setDialog({
      mode: "create",
      draft: { stageId: stageId ?? currentStage(data.stages)?.id, duration },
    });
  const editMeeting = (meeting: Meeting, stageName: string) =>
    setDialog({
      mode: "edit",
      meeting: { ...meeting, company_name: data.company_name, stage_name: stageName },
    });

  const pipeline = (
    <PipelineSection
      detail={data}
      pending={setStage.isPending}
      onStatus={(stageId, status) => setStage.mutate({ stageId, status })}
      onSchedule={schedule}
      onEditMeeting={editMeeting}
    />
  );
  const resume = (
    <ResumeSection
      detail={data}
      resume={data.tailored_resume}
      pending={patch.isPending}
      onLink={(resumeId) => patch.mutate({ tailored_resume_id: resumeId })}
    />
  );
  const company = (
    <CompanySection
      detail={data}
      onEdit={() => {
        patch.reset();
        setEditing(true);
      }}
    />
  );
  const notes = (
    <NotesSection
      saved={data.notes_markdown ?? ""}
      pending={patch.isPending}
      onSave={(notes_markdown) => patch.mutate({ notes_markdown })}
    />
  );
  const description = data.job_description_text ? (
    <DescriptionSection text={data.job_description_text} />
  ) : null;
  const danger = (
    <DeleteApplication
      name={data.company_name}
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
    />
  );

  return (
    <div className="space-y-6">
      <DetailHeader
        detail={data}
        layout={layout}
        pending={patch.isPending}
        onStatus={(status) => patch.mutate({ status })}
        onSchedule={() => schedule()}
        onEdit={() => {
          patch.reset();
          setEditing(true);
        }}
      />

      {suggestion?.stage_id && (
        <Alert>
          <CalendarPlus />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              Passed. Next up: <strong className="text-foreground">{suggestion.name}</strong>.
            </span>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                schedule(suggestion.stage_id!, suggestion.suggested_duration_min ?? undefined);
                setSuggestion(null);
              }}
            >
              Schedule it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <NextUp detail={data} onSchedule={schedule} onEditMeeting={editMeeting} />

      {layout === "page" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="min-w-0 space-y-6">
            {pipeline}
            {notes}
            {description}
          </div>
          <aside className="space-y-6">
            {resume}
            {company}
            {danger}
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          {resume}
          {company}
          {pipeline}
          {notes}
          {description}
          {danger}
        </div>
      )}

      <MeetingDialog state={dialog} onClose={() => setDialog(null)} />
      <EditApplicationDialog
        open={editing}
        detail={data}
        pending={patch.isPending}
        error={patch.error as Error | null}
        onOpenChange={setEditing}
        onSave={(body) => patch.mutate(body, { onSuccess: () => setEditing(false) })}
      />
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  meta,
  action,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex min-h-12 items-center gap-2.5 border-b px-4 py-2">
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {meta && <span className="text-muted-foreground text-xs tabular-nums">{meta}</span>}
        {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

function DetailHeader({
  detail,
  layout,
  pending,
  onStatus,
  onSchedule,
  onEdit,
}: {
  detail: ApplicationDetail;
  layout: Layout;
  pending: boolean;
  onStatus: (status: string) => void;
  onSchedule: () => void;
  onEdit: () => void;
}) {
  const Title = layout === "page" ? "h1" : "h2";
  return (
    <header className={cn("space-y-4", layout === "sheet" && "pr-10")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-xs">
            {detail.applied_at
              ? `Applied ${formatDateTime(detail.applied_at, "d MMM yyyy")}`
              : `Saved ${formatDateTime(detail.created_at, "d MMM yyyy")}`}{" "}
            · via {detail.origin}
          </p>
          <Title
            className={cn(
              "font-semibold tracking-tight text-balance",
              layout === "page" ? "text-2xl md:text-3xl" : "text-xl",
            )}
          >
            {detail.company_name}
          </Title>
          <p className="text-muted-foreground">{detail.role_title}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40">
            <StatusSelect
              size="default"
              value={detail.status}
              disabled={pending}
              label={`Status for ${detail.company_name}`}
              onChange={onStatus}
            />
          </div>
          {layout === "sheet" && (
            <Button asChild variant="outline" size="icon" aria-label="Open as a full page">
              <Link href={`/applications/${detail.id}`}>
                <Maximize2 />
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {detail.job_url ? (
          <Button asChild>
            <a href={detail.job_url} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open job posting
            </a>
          </Button>
        ) : (
          <Button variant="outline" onClick={onEdit}>
            <Link2 />
            Add the job link
          </Button>
        )}
        <Button variant="outline" onClick={onSchedule}>
          <CalendarPlus />
          Schedule
        </Button>
        <Button variant="outline" onClick={onEdit}>
          <Pencil />
          Edit details
        </Button>
      </div>
    </header>
  );
}

/** The one thing to act on: the next booked call, or the step still to book. */
function NextUp({
  detail,
  onSchedule,
  onEditMeeting,
}: {
  detail: ApplicationDetail;
  onSchedule: (stageId: string) => void;
  onEditMeeting: (meeting: Meeting, stageName: string) => void;
}) {
  const now = Date.now();
  const next = detail.stages
    .flatMap((stage) =>
      stage.meetings
        .filter((m) => m.status === "scheduled" && new Date(m.ends_at).getTime() >= now)
        .map((meeting) => ({ stage, meeting })),
    )
    .sort((a, b) => a.meeting.starts_at.localeCompare(b.meeting.starts_at))[0];

  if (next) {
    const minutes = Math.round((new Date(next.meeting.starts_at).getTime() - now) / 60_000);
    return (
      <div className="bg-accent/60 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <CalendarClock className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {next.stage.name} · {relative(minutes)}
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {formatDateTime(next.meeting.starts_at)}
            {next.meeting.location && ` · ${next.meeting.location}`}
          </p>
        </div>
        {next.meeting.conferencing_url && (
          <Button asChild size="sm">
            <a href={next.meeting.conferencing_url} target="_blank" rel="noreferrer">
              <Video />
              Join
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onEditMeeting(next.meeting, next.stage.name)}
        >
          Edit
        </Button>
      </div>
    );
  }

  const stage = currentStage(detail.stages);
  if (!stage || CLOSED_STATUSES.has(detail.status)) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3">
      <CalendarPlus className="text-muted-foreground size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{stage.name}</span>{" "}
        <span className="text-muted-foreground">has nothing booked yet.</span>
      </p>
      <Button size="sm" onClick={() => onSchedule(stage.id)}>
        Schedule it
      </Button>
    </div>
  );
}

function PipelineSection({
  detail,
  pending,
  onStatus,
  onSchedule,
  onEditMeeting,
}: {
  detail: ApplicationDetail;
  pending: boolean;
  onStatus: (stageId: string, status: string) => void;
  onSchedule: (stageId: string) => void;
  onEditMeeting: (meeting: Meeting, stageName: string) => void;
}) {
  const passed = detail.stages.filter((s) => s.status === "passed").length;
  return (
    <Section
      icon={ListChecks}
      title="Interview steps"
      meta={`${passed}/${detail.stages.length} passed`}
    >
      <Progress
        value={detail.stages.length ? (passed / detail.stages.length) * 100 : 0}
        className="h-1 rounded-none"
      />
      {!detail.stages.length ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-sm">
          This application has no steps yet.
        </p>
      ) : (
        <ol className="divide-y">
          {detail.stages.map((stage) => {
            const { label, tone, Icon } = stageStatus(stage.status);
            return (
              <li key={stage.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                    tone === "neutral" ? "bg-muted text-muted-foreground" : TONE_TINT[tone],
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{stage.name}</p>
                  {stage.meetings.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {stage.meetings.map((meeting) => (
                        <li
                          key={meeting.id}
                          className="flex flex-wrap items-center gap-x-2 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => onEditMeeting(meeting, stage.name)}
                            className={cn(
                              "text-muted-foreground hover:text-foreground tabular-nums underline-offset-2 hover:underline",
                              meeting.status === "cancelled" && "line-through",
                            )}
                          >
                            {formatDateTime(meeting.starts_at)}
                          </button>
                          <span className="text-subtle">
                            {meetingStatus(meeting.status).label}
                          </span>
                          {meeting.conferencing_url && meeting.status === "scheduled" && (
                            <a
                              href={meeting.conferencing_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              Join
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    stage.kind !== "applied" && (
                      <p className="text-subtle text-xs">No meeting booked</p>
                    )
                  )}
                </div>
                <StageMenu
                  stage={stage}
                  align="end"
                  disabled={pending}
                  onStatus={(status) => onStatus(stage.id, status)}
                  onSchedule={() => onSchedule(stage.id)}
                  onEditMeeting={(meeting) => onEditMeeting(meeting, stage.name)}
                >
                  <Button variant="outline" size="sm" className="shrink-0">
                    {label}
                    <ChevronDown />
                  </Button>
                </StageMenu>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function ResumeSection({
  detail,
  resume,
  pending,
  onLink,
}: {
  detail: ApplicationDetail;
  resume: TailoredResumeBrief | null;
  pending: boolean;
  onLink: (resumeId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const upgrade = useGeneration();
  const upgraded = upgrade.state.running ? null : upgrade.state.resultId;
  useEffect(() => {
    if (!upgraded) return;
    // The linked resume was rewritten in place; refetch everything showing it.
    queryClient.invalidateQueries({ queryKey: ["application"] });
    queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
  }, [upgraded, queryClient]);

  if (!resume) {
    const suggestion = detail.suggested_tailored_resume;
    return (
      <Section icon={FileText} title="Resume sent">
        <div className="space-y-4 p-4">
          {suggestion ? (
            <div className="border-primary/25 bg-accent/40 space-y-2.5 rounded-lg border p-3">
              <p className="text-sm">
                <span className="font-medium">{suggestion.display_name}</span> was tailored
                for this posting
                {suggestion.must_have_coverage_percent != null &&
                  ` · ${Math.round(suggestion.must_have_coverage_percent)}% must-have coverage`}
                .
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={pending} onClick={() => onLink(suggestion.id)}>
                  <Link2 />
                  Link it
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/resumes/tailored/${suggestion.id}`}>
                    <Pencil />
                    Review
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No resume is linked yet. Tailor one for this job, or link the version you
              applied with, so its coverage and interview prep sit next to the job.
            </p>
          )}
          <div className="space-y-1.5">
            <Button asChild className="w-full">
              <Link href={tailorHref(detail)}>
                <Sparkles />
                Tailor a resume for this job
              </Link>
            </Button>
            <p className="text-muted-foreground text-center text-xs">
              Opens the Tailor page with this job&apos;s description, company, role and link
              filled in.
            </p>
          </div>
          <Disclosure title="Or tailor it here">
            <TailorForJob detail={detail} />
          </Disclosure>
          <ResumePicker value={null} disabled={pending} onPick={onLink} />
        </div>
      </Section>
    );
  }

  const gaps = resume.flags?.uncovered_requirements ?? [];
  const probes = resume.flags?.interview_probes ?? [];
  const coverage = resume.must_have_coverage_percent;

  return (
    <Section
      icon={FileText}
      title="Resume sent"
      action={
        <div className="flex gap-1.5">
          <Button asChild size="sm" variant="outline">
            <Link href={`/resumes/tailored/${resume.id}`}>
              <Pencil />
              Review &amp; edit
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadDocx(
                { resume_id: resume.id, kind: "tailored", profile: "designed" },
                `${resume.display_name}.docx`,
              )
            }
          >
            <Download />
            .docx
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div className="space-y-0.5">
          <p className="font-medium">{resume.display_name}</p>
          <p className="text-muted-foreground text-xs">
            Tailored from {resume.base_resume_name ?? "a base resume"} ·{" "}
            {formatDateTime(resume.created_at, "d MMM yyyy")}
            {resume.status !== "final" && ` · ${humanize(resume.status)}`}
          </p>
        </div>

        {coverage != null && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Must-have coverage</span>
              <span className="font-medium tabular-nums">
                {resume.must_have_covered != null &&
                  resume.must_have_total != null &&
                  `${resume.must_have_covered}/${resume.must_have_total} · `}
                {Math.round(coverage)}%
              </span>
            </div>
            <Progress value={coverage} className="h-1.5" />
          </div>
        )}

        <FactList
          items={[
            {
              label: "Nice-to-have coverage",
              value:
                resume.nice_to_have_coverage_percent != null
                  ? `${Math.round(resume.nice_to_have_coverage_percent)}%`
                  : "—",
            },
            {
              label: "Years asked / shown",
              value: `${resume.years_required ?? "—"} / ${resume.years_shown ?? "—"}`,
            },
            { label: "Tailored via", value: humanize(resume.job_source), tone: "muted" },
          ]}
        />

        <div className="space-y-2.5 rounded-lg border p-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={upgrade.state.running}
              onClick={() =>
                upgrade.start(`/api/v1/tailored-resumes/${resume.id}/upgrade`, {
                  strategy: "existing",
                })
              }
            >
              <RefreshCw />
              Upgrade existing
            </Button>
            <Button
              size="sm"
              disabled={upgrade.state.running}
              onClick={() =>
                upgrade.start(`/api/v1/tailored-resumes/${resume.id}/upgrade`, {
                  strategy: "full",
                })
              }
            >
              <WandSparkles />
              Full upgrade
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href={tailorHref(detail)}>
                <Sparkles />
                Open in Tailor
              </Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Upgrade existing keeps employers, titles and dates and rewrites for this
            posting&apos;s keywords. Full upgrade builds a new resume from the job
            description. Both replace this version, so the application stays linked.
          </p>
          {(upgrade.state.running || upgrade.state.error) && (
            <GenerationProgress state={upgrade.state} />
          )}
        </div>

        {gaps.length > 0 && (
          <Disclosure title={`Gaps to prepare for (${gaps.length})`}>
            <ul className="space-y-3">
              {gaps.map((gap, index) => (
                <li key={index} className="space-y-0.5 text-sm">
                  <p className="font-medium">{gap.requirement}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {gap.how_to_close}
                  </p>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {probes.length > 0 && (
          <Disclosure title={`Likely interview questions (${probes.length})`}>
            <ul className="space-y-3">
              {probes.map((probe, index) => (
                <li key={index} className="space-y-0.5 text-sm">
                  <p className="font-medium">{probe.question}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {probe.suggested_answer}
                  </p>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure title="Resume content">
          <ScrollArea className="h-72 rounded-md border">
            <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {resume.content_markdown}
            </pre>
          </ScrollArea>
        </Disclosure>

        <div className="flex items-center gap-2 border-t pt-3">
          <div className="min-w-0 flex-1">
            <ResumePicker value={resume.id} disabled={pending} onPick={onLink} />
          </div>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onLink(null)}>
            Unlink
          </Button>
        </div>
      </div>
    </Section>
  );
}

/**
 * The Tailor page, filled in from this application. The base resume comes from
 * the linked resume, or failing that the one tailored for this posting.
 */
function tailorHref(detail: ApplicationDetail): string {
  const params = new URLSearchParams({ application: detail.id });
  const base =
    detail.tailored_resume?.base_resume_id ?? detail.suggested_tailored_resume?.base_resume_id;
  if (base) params.set("base", base);
  return `/tailor?${params}`;
}

/**
 * Tailor straight from the application, against the job description saved
 * with it. The result is linked here when it lands, so the card fills itself.
 */
function TailorForJob({ detail }: { detail: ApplicationDetail }) {
  const queryClient = useQueryClient();
  const tailor = useGeneration();
  const [baseId, setBaseId] = useState("");
  const [strategy, setStrategy] = useState<"existing" | "full">("existing");
  const { data: bases } = useQuery({
    queryKey: ["resumes", ""],
    queryFn: () =>
      request<{ items: { id: string; display_name: string }[] }>("/api/v1/resumes"),
  });
  const items = bases?.items ?? [];
  const chosen = baseId || items[0]?.id || "";
  const running = tailor.state.running;

  const finished = running ? null : tailor.state.resultId;
  useEffect(() => {
    if (!finished) return;
    queryClient.invalidateQueries({ queryKey: ["application", detail.id] });
    queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
  }, [finished, detail.id, queryClient]);

  const tailorPage = tailorHref(detail);

  if ((detail.job_description_text ?? "").trim().length < 40) {
    return (
      <p className="text-muted-foreground text-xs leading-relaxed">
        No job description is saved with this application, so it can&apos;t be tailored
        from here. Add it under Edit details, or{" "}
        <Link href={tailorPage} className="text-primary hover:underline">
          paste it on the Tailor page
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-2.5 rounded-lg border p-3">
      <p className="text-sm font-medium">Tailor without leaving this page</p>
      <Select
        value={chosen}
        onValueChange={(v) => v && setBaseId(v)}
        disabled={running || !items.length}
      >
        <SelectTrigger className="w-full" aria-label="Base resume">
          <SelectValue placeholder={items.length ? "Choose a base resume…" : "No base resumes yet"} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to tailor">
        {(["existing", "full"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            role="radio"
            aria-checked={strategy === option}
            variant={strategy === option ? "secondary" : "ghost"}
            disabled={running}
            onClick={() => setStrategy(option)}
          >
            {option === "existing" ? <RefreshCw /> : <WandSparkles />}
            {option === "existing" ? "Upgrade existing" : "Full upgrade"}
          </Button>
        ))}
      </div>
      <Button
        className="w-full"
        disabled={!chosen || running}
        onClick={() =>
          tailor.start(`/api/v1/applications/${detail.id}/tailor`, {
            base_resume_id: chosen,
            strategy,
          })
        }
      >
        {running ? <Spinner /> : <Sparkles />}
        {running ? "Tailoring…" : "Tailor and link"}
      </Button>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Uses the job description saved with this application, and links the result here.{" "}
        <Link href={tailorPage} className="text-primary hover:underline">
          Open in the Tailor page
        </Link>
      </p>
      {(running || tailor.state.error) && <GenerationProgress state={tailor.state} />}
    </div>
  );
}

function ResumePicker({
  value,
  disabled,
  onPick,
}: {
  value: string | null;
  disabled: boolean;
  onPick: (resumeId: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["tailored-resumes", "picker"],
    queryFn: () =>
      request<{ items: { id: string; display_name: string }[] }>(
        "/api/v1/tailored-resumes?limit=100",
      ),
  });
  const items = data?.items ?? [];
  return (
    <Select
      value={value ?? ""}
      // Radix can report an empty value while its items reload; that is not a pick.
      onValueChange={(v) => v && onPick(v)}
      disabled={disabled || !items.length}
    >
      <SelectTrigger className="w-full" aria-label="Linked tailored resume">
        <SelectValue
          placeholder={items.length ? "Link a tailored resume…" : "No tailored resumes yet"}
        />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CompanySection({ detail, onEdit }: { detail: ApplicationDetail; onEdit: () => void }) {
  const query = encodeURIComponent(detail.company_name);
  const site = detail.company_domain
    ? /^https?:\/\//.test(detail.company_domain)
      ? detail.company_domain
      : `https://${detail.company_domain}`
    : null;
  const research: [string, string][] = [
    ["Web", `https://www.google.com/search?q=${query}`],
    ["News", `https://news.google.com/search?q=${query}`],
    ["LinkedIn", `https://www.linkedin.com/search/results/companies/?keywords=${query}`],
    ["Glassdoor", `https://www.glassdoor.com/Search/results.htm?keyword=${query}`],
  ];

  return (
    <Section
      icon={Building2}
      title="Company & job"
      action={
        <Button variant="ghost" size="icon-sm" aria-label="Edit details" onClick={onEdit}>
          <Pencil />
        </Button>
      }
    >
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
            {initials(detail.company_name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{detail.company_name}</p>
            {site ? (
              <a
                href={site}
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
              >
                <Globe className="size-3" />
                {site.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              <button
                type="button"
                onClick={onEdit}
                className="text-muted-foreground text-xs hover:underline"
              >
                Add the company website
              </button>
            )}
          </div>
        </div>

        <FactList
          items={[
            { label: "Role", value: detail.role_title },
            {
              label: "Job link",
              value: detail.job_url ? (
                <a
                  href={detail.job_url}
                  target="_blank"
                  rel="noreferrer"
                  title={detail.job_url}
                  className="text-primary inline-block max-w-44 truncate align-bottom hover:underline"
                >
                  {hostOf(detail.job_url)}
                </a>
              ) : (
                "—"
              ),
            },
            { label: "Location", value: detail.location ?? "—" },
            {
              label: "Work mode",
              value: detail.work_mode ? humanize(detail.work_mode) : "—",
            },
            { label: "Salary", value: formatSalary(detail) ?? "—" },
          ]}
        />

        <div>
          <p className="text-muted-foreground mb-2 text-xs">Research the company</p>
          <div className="flex flex-wrap gap-1.5">
            {research.map(([label, href]) => (
              <Button key={label} asChild variant="outline" size="xs">
                <a href={href} target="_blank" rel="noreferrer">
                  <Search />
                  {label}
                </a>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function NotesSection({
  saved,
  pending,
  onSave,
}: {
  saved: string;
  pending: boolean;
  onSave: (notes: string) => void;
}) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = draft !== saved;

  return (
    <Section
      icon={NotebookPen}
      title="Notes"
      action={
        <Button size="sm" disabled={!dirty || pending} onClick={() => onSave(draft)}>
          <Save />
          {dirty ? "Save" : "Saved"}
        </Button>
      }
    >
      <div className="p-4">
        <Textarea
          aria-label="Notes"
          rows={5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Who you spoke to, what they asked, what to follow up on…"
          className="field-sizing-fixed min-h-28"
        />
      </div>
    </Section>
  );
}

function DescriptionSection({ text }: { text: string }) {
  return (
    <Section icon={FileText} title="Job description">
      <ScrollArea className="h-80">
        <p className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
      </ScrollArea>
    </Section>
  );
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="group/disclosure rounded-lg border">
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors">
        {title}
        <ChevronDown className="text-muted-foreground size-4 transition-transform group-data-[state=open]/disclosure:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function DeleteApplication({
  name,
  pending,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
          Delete application
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the {name} application?</AlertDialogTitle>
          <AlertDialogDescription>
            Its interview steps, meetings and notes go with it. The tailored resume stays in
            Resumes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={onConfirm}
            className={cn(buttonVariants({ variant: "destructive" }))}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DetailSkeleton({ layout }: { layout: Layout }) {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-14 w-full" />
      <div
        className={cn(
          "grid gap-6",
          layout === "page" && "lg:grid-cols-[minmax(0,1fr)_22rem]",
        )}
      >
        <Skeleton className="h-96" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("") || "?"
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatSalary(detail: ApplicationDetail): string | null {
  const { salary_min: low, salary_max: high } = detail;
  if (low == null && high == null) return null;
  let format = (value: number) => value.toLocaleString("en-US");
  try {
    const currency = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: detail.salary_currency || "USD",
      maximumFractionDigits: 0,
    });
    format = (value) => currency.format(value);
  } catch {
    // An unknown currency code: plain numbers still say the range.
  }
  if (low != null && high != null) return `${format(low)} – ${format(high)}`;
  return low != null ? `from ${format(low)}` : `up to ${format(high!)}`;
}
