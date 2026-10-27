"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  ChevronDown,
  Download,
  ExternalLink,
  Globe,
  Link2,
  Maximize2,
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
import { useEffect, useState, type ReactNode } from "react";

import { EditApplicationDialog } from "@/components/remote/applications/edit-dialog";
import { StageMenu } from "@/components/remote/applications/stage-menu";
import { StatusSelect } from "@/components/remote/applications/status-select";
import { CompanyMark, StepMark } from "@/components/remote/applications/step-mark";
import {
  MeetingDialog,
  type MeetingDialogState,
} from "@/components/shared/calendar/meeting-dialog";
import { ErrorAlert } from "@/components/error-alert";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { PageHero } from "@/components/page-hero";
import { Panel, PanelHead } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
  resumeHref,
  stageStatus,
  type ApplicationDetail,
  type ResumeBrief,
  type ResumeKind,
  type ResumeRef,
  type StageUpdated,
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
    queryFn: () => request<ApplicationDetail>(`/api/v1/remote/applications/${id}`),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<ApplicationDetail>(`/api/v1/remote/applications/${id}`, {
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
      request<StageUpdated>(`/api/v1/remote/stages/${stageId}`, {
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
    mutationFn: () => request(`/api/v1/remote/applications/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["application", id] });
      invalidateSchedule(queryClient);
      onDeleted?.();
    },
  });

  if (error) {
    return (
      <ErrorAlert title="We couldn’t open that application.">{(error as Error).message}</ErrorAlert>
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
      resume={data.resume}
      pending={patch.isPending}
      onLink={(ref) =>
        patch.mutate(
          { resume: ref },
          {
            // The resume cards list the jobs each resume is linked to.
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ["resumes"] });
              queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
            },
          },
        )
      }
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
    <div className="flex justify-center">
      <DeleteApplication
        name={data.company_name}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );

  return (
    <div className="space-y-3">
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
              size="xs"
              className="ml-auto"
              onClick={() => {
                schedule(suggestion.stage_id!, suggestion.suggested_duration_min ?? undefined);
                setSuggestion(null);
              }}
            >
              Schedule it
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSuggestion(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <NextUp detail={data} onSchedule={schedule} onEditMeeting={editMeeting} />

      {layout === "page" ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="min-w-0 space-y-3">
            {pipeline}
            {notes}
            {description}
          </div>
          <aside className="space-y-3">
            {resume}
            {company}
            {danger}
          </aside>
        </div>
      ) : (
        <div className="space-y-2">
          {pipeline}
          {notes}
          {resume}
          {company}
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
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel>
      <PanelHead title={title}>
        {meta && <span className="text-muted-foreground text-xs tabular-nums">{meta}</span>}
        {action}
      </PanelHead>
      <div className="p-3">{children}</div>
    </Panel>
  );
}

/** Label/value rows for a record's facts. */
function Facts({
  items,
}: {
  items: { label: string; value: ReactNode; tone?: "default" | "muted" }[];
}) {
  return (
    <dl className="divide-y text-[13px]">
      {items.map(({ label, value, tone }) => (
        <div key={label} className="flex items-baseline justify-between gap-3 py-1 first:pt-0 last:pb-0">
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className={cn("min-w-0 truncate text-right tabular-nums", tone === "muted" && "text-muted-foreground")}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
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
  const when = `${
    detail.applied_at
      ? `Applied ${formatDateTime(detail.applied_at, "d MMM yyyy")}`
      : `Saved ${formatDateTime(detail.created_at, "d MMM yyyy")}`
  } · via ${detail.origin}`;

  const status = (
    <StatusSelect
      appearance="field"
      value={detail.status}
      disabled={pending}
      label={`Status for ${detail.company_name}`}
      onChange={onStatus}
    />
  );
  const posting = detail.job_url ? (
    <Button asChild variant="outline">
      <a href={detail.job_url} target="_blank" rel="noreferrer">
        <ExternalLink />
        Job posting
      </a>
    </Button>
  ) : (
    <Button variant="outline" onClick={onEdit}>
      <Link2 />
      Add the job link
    </Button>
  );

  if (layout === "page") {
    return (
      <PageHero
        back="/remote/applications"
        title={detail.company_name}
        description={`${detail.role_title} · ${when}`}
        actions={
          <>
            <div className="w-36">{status}</div>
            {posting}
            <Button variant="outline" onClick={onSchedule}>
              <CalendarPlus />
              Schedule
            </Button>
            <Button variant="outline" onClick={onEdit}>
              <Pencil />
              Edit details
            </Button>
          </>
        }
      />
    );
  }

  return (
    <header className="space-y-2">
      <div className="flex items-start justify-between gap-2 pr-8">
        <div className="min-w-0">
          <h2 className="font-heading truncate text-lg leading-tight font-semibold">{detail.company_name}</h2>
          <p className="text-muted-foreground truncate text-[13px]">{detail.role_title}</p>
          <p className="text-subtle text-xs">{when}</p>
        </div>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Open as a full page"
        >
          <Link href={`/remote/applications/${detail.id}`}>
            <Maximize2 />
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">{status}</div>
        {posting}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" onClick={onSchedule}>
          <CalendarPlus />
          Schedule
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
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
      <div className="bg-accent text-accent-foreground flex flex-wrap items-center gap-2 rounded-lg px-3 py-1.5">
        <Video className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate text-[13px]">
          <span className="font-semibold">
            {next.stage.name} · {relative(minutes)}
          </span>
          <span className="tabular-nums">
            {" "}
            · {formatDateTime(next.meeting.starts_at)}
            {next.meeting.location && ` · ${next.meeting.location}`}
          </span>
        </p>
        {next.meeting.conferencing_url && (
          <Button asChild size="xs">
            <a href={next.meeting.conferencing_url} target="_blank" rel="noreferrer">
              <Video />
              Join
            </a>
          </Button>
        )}
        <Button size="xs" variant="outline" onClick={() => onEditMeeting(next.meeting, next.stage.name)}>
          Edit
        </Button>
      </div>
    );
  }

  const stage = currentStage(detail.stages);
  if (!stage || CLOSED_STATUSES.has(detail.status)) return null;
  return (
    <Panel className="flex flex-wrap items-center gap-2 px-3 py-1.5">
      <p className="min-w-0 flex-1 text-[13px]">
        <span className="font-semibold">{stage.name}</span>{" "}
        <span className="text-muted-foreground">has nothing booked yet.</span>
      </p>
      <Button size="xs" onClick={() => onSchedule(stage.id)}>
        Schedule it
      </Button>
    </Panel>
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
    <Section title="Interview steps" meta={`${passed}/${detail.stages.length} passed`}>
      {!detail.stages.length ? (
        <p className="text-muted-foreground text-xs">This application has no steps yet.</p>
      ) : (
        <ol className="divide-y">
          {detail.stages.map((stage) => {
            const { label } = stageStatus(stage.status);
            return (
              <li key={stage.id} className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0">
                <StepMark status={stage.status} className="mt-px" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{stage.name}</p>
                  {stage.meetings.length > 0 ? (
                    <ul className="space-y-0.5">
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
                          <span className="text-subtle">{meetingStatus(meeting.status).label}</span>
                          {meeting.conferencing_url && meeting.status === "scheduled" && (
                            <a
                              href={meeting.conferencing_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent-foreground font-medium hover:underline"
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
                  <Button variant="outline" size="xs" className="shrink-0">
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
  resume: ResumeBrief | null;
  pending: boolean;
  onLink: (resume: ResumeRef | null) => void;
}) {
  const queryClient = useQueryClient();
  const upgrade = useGeneration();
  const upgraded = upgrade.state.running ? null : upgrade.state.resultId;
  useEffect(() => {
    if (!upgraded) return;
    // The linked resume was rewritten in place; refetch everything showing it.
    queryClient.invalidateQueries({ queryKey: ["application"] });
    queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
    queryClient.invalidateQueries({ queryKey: ["resumes"] });
  }, [upgraded, queryClient]);

  if (!resume) {
    const suggestion = detail.suggested_resume;
    return (
      <Section title="Resume sent">
        <div className="space-y-2">
          {suggestion ? (
            <div className="bg-accent space-y-1.5 rounded-md p-2">
              <p className="text-accent-foreground text-[13px]">
                <span className="font-semibold">{suggestion.display_name}</span>{" "}
                {suggestion.reason === "panel"
                  ? "is this posting’s resume in the side panel"
                  : "was tailored for this posting"}
                {suggestion.must_have_coverage_percent != null &&
                  ` · ${Math.round(suggestion.must_have_coverage_percent)}% must-have coverage`}
                .
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="xs"
                  disabled={pending}
                  onClick={() => onLink({ kind: suggestion.kind, id: suggestion.id })}
                >
                  <Link2 />
                  Link it
                </Button>
                <Button asChild size="xs" variant="outline">
                  <Link href={resumeHref(suggestion)}>
                    <Pencil />
                    Review
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">No resume is linked yet.</p>
          )}
          <Button asChild className="w-full">
            <Link href={tailorHref(detail)}>
              <Sparkles />
              Tailor a resume for this job
            </Link>
          </Button>
          <Disclosure title="Or tailor it here">
            <TailorForJob detail={detail} />
          </Disclosure>
          <ResumePicker linked={null} disabled={pending} onPick={onLink} />
        </div>
      </Section>
    );
  }

  const tailored = resume.kind === "tailored";
  const gaps = resume.flags?.uncovered_requirements ?? [];
  const probes = resume.flags?.interview_probes ?? [];
  const coverage = resume.must_have_coverage_percent;
  // A base resume is only scored once it has been tailored to this job.
  const scored = tailored || resume.must_have_total != null;
  const others = resume.shared_with;

  return (
    <Section
      title="Resume sent"
      action={
        <>
          <Button asChild size="xs" variant="outline">
            <Link href={resumeHref(resume)}>
              <Pencil />
              Review &amp; edit
            </Link>
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              downloadDocx(
                { resume_id: resume.id, kind: resume.kind, profile: "designed" },
                `${resume.display_name}.docx`,
              )
            }
          >
            <Download />
            .docx
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {coverage != null && (
            <span className="text-base font-semibold tabular-nums">{Math.round(coverage)}%</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{resume.display_name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {resume.must_have_covered != null && resume.must_have_total != null
                ? `${resume.must_have_covered} of ${resume.must_have_total} must-haves · `
                : ""}
              {tailored ? (resume.base_resume_name ?? "a base resume") : "Base resume, as it is"}
            </p>
          </div>
          <StatusBadge tone={resume.status === "final" ? "ok" : "warn"}>
            {humanize(resume.status)}
          </StatusBadge>
        </div>

        <Facts
          items={[
            ...(scored
              ? [
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
                ]
              : []),
            ...(tailored
              ? [
                  {
                    label: "Tailored via",
                    value: humanize(resume.job_source ?? "web"),
                    tone: "muted" as const,
                  },
                ]
              : others > 0
                ? [
                    {
                      label: "Also sent with",
                      value: `${others} other application${others === 1 ? "" : "s"}`,
                      tone: "muted" as const,
                    },
                  ]
                : []),
            {
              label: "Updated",
              value: formatDateTime(resume.updated_at, "d MMM yyyy"),
              tone: "muted",
            },
          ]}
        />

        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            className="flex-1"
            disabled={upgrade.state.running}
            onClick={() =>
              upgrade.start(`/api/v1/remote/applications/${detail.id}/upgrade-resume`, {
                strategy: "existing",
              })
            }
          >
            <RefreshCw />
            Upgrade existing
          </Button>
          <Button
            size="xs"
            className="flex-1"
            disabled={upgrade.state.running}
            onClick={() =>
              upgrade.start(`/api/v1/remote/applications/${detail.id}/upgrade-resume`, {
                strategy: "full",
              })
            }
          >
            <WandSparkles />
            Full upgrade
          </Button>
        </div>
        {(upgrade.state.running || upgrade.state.error) && (
          <GenerationProgress state={upgrade.state} onStop={upgrade.stop} />
        )}

        {gaps.length > 0 && (
          <Disclosure title={`Gaps to prepare for (${gaps.length})`}>
            <ul className="space-y-1.5">
              {gaps.map((gap, index) => (
                <li key={index} className="space-y-0.5 text-[13px]">
                  <p className="font-medium">{gap.requirement}</p>
                  <p className="text-muted-foreground text-xs leading-snug">
                    {gap.how_to_close}
                  </p>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {probes.length > 0 && (
          <Disclosure title={`Likely interview questions (${probes.length})`}>
            <ul className="space-y-1.5">
              {probes.map((probe, index) => (
                <li key={index} className="space-y-0.5 text-[13px]">
                  <p className="font-medium">{probe.question}</p>
                  <p className="text-muted-foreground text-xs leading-snug">
                    {probe.suggested_answer}
                  </p>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure title="Resume content">
          <ScrollArea className="bg-muted/50 h-72 rounded-md">
            <pre className="p-2 font-mono text-xs leading-snug whitespace-pre-wrap">
              {resume.content_markdown}
            </pre>
          </ScrollArea>
        </Disclosure>

        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <ResumePicker linked={resume} disabled={pending} onPick={onLink} />
          </div>
          <Button variant="outline" disabled={pending} onClick={() => onLink(null)}>
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
  const base = detail.resume?.base_resume_id ?? detail.suggested_resume?.base_resume_id;
  if (base) params.set("base", base);
  return `/remote/tailor?${params}`;
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
      request<{ items: { id: string; display_name: string }[] }>("/api/v1/remote/resumes"),
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
      <p className="text-muted-foreground text-xs">
        No job description is saved with this application. Add it under Edit details, or{" "}
        <Link href={tailorPage} className="text-primary hover:underline">
          paste it on the Tailor page
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Select
        value={chosen}
        onValueChange={(v) => v && setBaseId(v)}
        disabled={running || !items.length}
      >
        <SelectTrigger className="w-full" aria-label="Base resume">
          <SelectValue
            placeholder={items.length ? "Choose a base resume…" : "No base resumes yet"}
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
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="How to tailor">
        {(["existing", "full"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="xs"
            role="radio"
            aria-checked={strategy === option}
            variant={strategy === option ? "default" : "outline"}
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
          tailor.start(`/api/v1/remote/applications/${detail.id}/tailor`, {
            base_resume_id: chosen,
            strategy,
          })
        }
      >
        {running ? <Spinner /> : <Sparkles />}
        {running ? "Tailoring…" : "Tailor and link"}
      </Button>
      <Link href={tailorPage} className="text-primary block text-xs hover:underline">
        Open in the Tailor page
      </Link>
      {(running || tailor.state.error) && <GenerationProgress state={tailor.state} onStop={tailor.stop} />}
    </div>
  );
}

/** Every resume, tailored and base, with the linked one in it even when it is not listed. */
function ResumePicker({
  linked,
  disabled,
  onPick,
}: {
  linked: ResumeBrief | null;
  disabled: boolean;
  onPick: (resume: ResumeRef) => void;
}) {
  const { data: tailoredList } = useQuery({
    queryKey: ["tailored-resumes", "picker"],
    queryFn: () =>
      request<{ items: { id: string; display_name: string }[] }>(
        "/api/v1/remote/tailored-resumes?limit=100",
      ),
  });
  const { data: baseList } = useQuery({
    queryKey: ["resumes", ""],
    queryFn: () =>
      request<{ items: { id: string; display_name: string }[] }>("/api/v1/remote/resumes"),
  });
  const options = (kind: ResumeKind, items: { id: string; display_name: string }[]) => {
    const missing = linked?.kind === kind && !items.some((item) => item.id === linked.id);
    return missing ? [{ id: linked.id, display_name: linked.display_name }, ...items] : items;
  };
  const tailored = options("tailored", tailoredList?.items ?? []);
  const bases = options("base", baseList?.items ?? []);

  return (
    <Select
      value={linked ? `${linked.kind}:${linked.id}` : ""}
      // Radix can report an empty value while its items reload; that is not a pick.
      onValueChange={(value) => {
        const [kind, id] = value.split(":");
        if (id) onPick({ kind: kind as ResumeKind, id });
      }}
      disabled={disabled || !(tailored.length + bases.length)}
    >
      <SelectTrigger className="w-full" aria-label="Linked resume">
        <SelectValue
          placeholder={tailored.length + bases.length ? "Link a resume…" : "No resumes yet"}
        />
      </SelectTrigger>
      <SelectContent>
        {tailored.length > 0 && (
          <SelectGroup>
            <SelectLabel>Tailored</SelectLabel>
            {tailored.map((item) => (
              <SelectItem key={item.id} value={`tailored:${item.id}`}>
                {item.display_name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {tailored.length > 0 && bases.length > 0 && <SelectSeparator />}
        {bases.length > 0 && (
          <SelectGroup>
            <SelectLabel>Base, as it is</SelectLabel>
            {bases.map((item) => (
              <SelectItem key={item.id} value={`base:${item.id}`}>
                {item.display_name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
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
      title="Company & job"
      action={
        <Button variant="ghost" size="icon-xs" aria-label="Edit details" onClick={onEdit}>
          <Pencil />
        </Button>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CompanyMark name={detail.company_name} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{detail.company_name}</p>
            {site ? (
              <a
                href={site}
                target="_blank"
                rel="noreferrer"
                className="text-accent-foreground inline-flex items-center gap-1 text-xs hover:underline"
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

        <Facts
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
                  className="text-accent-foreground inline-block max-w-44 truncate align-bottom hover:underline"
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

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground mr-1 text-xs">Research</span>
          <div className="flex flex-wrap gap-1">
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
    <Section title="Prep notes">
      <Textarea
        aria-label="Notes"
        rows={4}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Who you spoke to, what they asked, what to follow up on…"
        className="field-sizing-fixed min-h-20"
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="xs"
          disabled={!dirty || pending}
          onClick={() => onSave(draft)}
        >
          <Save />
          {dirty ? "Save notes" : "Saved"}
        </Button>
      </div>
    </Section>
  );
}

function DescriptionSection({ text }: { text: string }) {
  return (
    <Section title="Job description">
      <ScrollArea className="h-80">
        <p className="text-[13px] leading-snug whitespace-pre-wrap">{text}</p>
      </ScrollArea>
    </Section>
  );
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="group/disclosure rounded-md border">
      <CollapsibleTrigger className="focus-visible:ring-ring/40 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium outline-none focus-visible:ring-2">
        {title}
        <ChevronDown className="text-muted-foreground size-3.5 transition-transform group-data-[state=open]/disclosure:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2.5 pt-1 pb-2">{children}</CollapsibleContent>
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
        <Button variant="destructive" size="sm">
          <Trash2 />
          Delete application
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the {name} application?</AlertDialogTitle>
          <AlertDialogDescription>
            Its interview steps, meetings and notes go with it. Its resume stays in Resumes.
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
    <div className="space-y-3" aria-busy>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-9 w-full" />
      <div className={cn("grid gap-3", layout === "page" && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
        <Skeleton className="h-96" />
        <Skeleton className="h-72" />
      </div>
    </div>
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
