"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Lightbulb, Pause, Play, Plus, Repeat, Wrench, X } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { NextCallBanner } from "@/components/shared/next-call";
import { PageHero } from "@/components/page-hero";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { request } from "@/lib/api";
import { dayLabel } from "@/lib/calendar";
import type { PortalId } from "@/lib/portals";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  employer_name: string;
  role_title: string;
  start_date: string;
  manager_name: string | null;
  team: string | null;
  status: string;
  notes_markdown: string | null;
}

interface Series {
  id: string;
  title: string;
  recurrence_rule: string;
  start_date: string;
  start_time_local: string;
  duration_min: number;
  is_active: boolean;
  materialized_through: string | null;
  preparation_template: string | null;
}

const MAINTENANCE_STEPS = (addStep: string) => [
  { title: "Add the job", detail: addStep },
  {
    title: "Add its recurring meetings",
    detail: "Standups and 1:1s, with a standing preparation note.",
  },
  {
    title: "Prep each occurrence",
    detail: "Every materialised meeting carries its own notes on the calendar.",
  },
];

const MAINTENANCE_TIPS = [
  "Pause a series instead of deleting it — the history stays.",
  "A standing preparation note is copied onto every new occurrence.",
  "Meetings materialise 90 days ahead, so the calendar stays honest.",
  "Per-occurrence notes live on the meeting, not the series.",
];

const RECURRENCE_OPTIONS: [string, string][] = [
  ["FREQ=WEEKLY;BYDAY=MO", "Weekly on Monday"],
  ["FREQ=WEEKLY;BYDAY=TU", "Weekly on Tuesday"],
  ["FREQ=WEEKLY;BYDAY=WE", "Weekly on Wednesday"],
  ["FREQ=WEEKLY;BYDAY=TH", "Weekly on Thursday"],
  ["FREQ=WEEKLY;BYDAY=FR", "Weekly on Friday"],
  ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "Every other Monday"],
  ["FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", "Every weekday"],
  ["FREQ=MONTHLY;BYDAY=1MO", "First Monday monthly"],
];

/** "14 Sep 2026" from an ISO civil date; anything else is shown as given. */
function shortDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayLabel(value, "d MMM yyyy") : value;
}

/** What the same page says in each portal: a remote job, or a won freelancing contract. */
const COPY = {
  remote: {
    eyebrow: "After the offer",
    description:
      "Roles you have started. Recurring team meetings materialise 90 days ahead so each occurrence can carry its own prep notes.",
    add: "Add a job",
    employer: "Employer",
    role: "Role",
    save: "Save job",
    emptyTitle: "No maintained jobs yet",
    emptyDescription:
      "When an application reaches contract signed, promote it here to keep its recurring meetings and notes.",
    addStep: "Employer, role and start date, plus who you report to.",
    count: (n: number) => (n === 1 ? "Job" : "Jobs"),
  },
  freelancing: {
    eyebrow: "After the win",
    description:
      "Contracts you have won. Recurring client meetings materialise 90 days ahead so each occurrence can carry its own prep notes.",
    add: "Add a contract",
    employer: "Client",
    role: "Contract",
    save: "Save contract",
    emptyTitle: "No contracts yet",
    emptyDescription:
      "When a bid is won, promote it from the pipeline to keep its recurring meetings and notes.",
    addStep: "Client, contract title and start date, plus who you work with.",
    count: (n: number) => (n === 1 ? "Contract" : "Contracts"),
  },
} as const;

/** Job maintenance for one portal: only the jobs it won, and new ones are filed under it. */
export function MaintenancePage({ portal }: { portal: PortalId }) {
  const copy = COPY[portal];
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["maintained-jobs", portal],
    queryFn: () => request<Job[]>(`/api/v1/shared/maintained-jobs?category=${portal}`),
  });

  // Same keys as each job's own series panel, so opening one costs no request.
  const seriesQueries = useQueries({
    queries: (jobs ?? []).map((job) => ({
      queryKey: ["series", job.id],
      queryFn: () => request<Series[]>(`/api/v1/shared/maintained-jobs/${job.id}/series`),
    })),
  });
  const seriesLoaded = seriesQueries.every((query) => query.data);
  const allSeries = seriesQueries.flatMap((query) => query.data ?? []);

  const createJob = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<Job>("/api/v1/shared/maintained-jobs", {
        method: "POST",
        body: JSON.stringify({ ...body, category: portal }),
      }),
    onSuccess: () => {
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["maintained-jobs"] });
    },
  });

  return (
    <div className="space-y-7">
      <PageHero
        title="Job maintenance"
        stats={
          jobs && seriesLoaded
            ? [
                { value: jobs.length, label: copy.count(jobs.length) },
                { value: allSeries.length, label: "Meeting series" },
                { value: allSeries.filter((s) => !s.is_active).length, label: "Paused" },
              ]
            : undefined
        }
        actions={
          <Button variant="secondary" size="lg" onClick={() => setCreating((v) => !v)}>
            {creating ? <X /> : <Plus />}
            {creating ? "Cancel" : copy.add}
          </Button>
        }
      />

      <div className="-mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <Badge variant="outline" className="h-[30px] gap-1.5 px-3 text-[0.8125rem]">
          <Wrench />
          {copy.eyebrow}
        </Badge>
        <p className="text-muted-foreground max-w-3xl text-[0.9375rem] leading-snug font-medium">
          {copy.description}
        </p>
      </div>

      <NextCallBanner />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:items-start">
        <div className="min-w-0 space-y-5">
          {creating && (
            <Card className="gap-0 p-7">
              <div className="mb-[22px] flex items-center gap-3.5">
                <Tile icon={Plus} />
                <h2 className="text-[1.375rem] font-medium tracking-tight">{copy.add}</h2>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  createJob.mutate(Object.fromEntries(f.entries()));
                }}
              >
                <FieldGroup>
                  <div className="grid gap-x-5 gap-y-[18px] sm:grid-cols-2">
                    <FormField label={copy.employer}>
                      {(control) => <Input {...control} name="employer_name" required />}
                    </FormField>
                    <FormField label={copy.role}>
                      {(control) => <Input {...control} name="role_title" required />}
                    </FormField>
                    <FormField label="Start date">
                      {(control) => <Input {...control} name="start_date" type="date" required />}
                    </FormField>
                    <FormField label="Manager">
                      {(control) => <Input {...control} name="manager_name" />}
                    </FormField>
                  </div>
                  <Button
                    type="submit"
                    variant="brand"
                    size="lg"
                    className="mt-1 self-start"
                    disabled={createJob.isPending}
                  >
                    {createJob.isPending && <Spinner />}
                    {copy.save}
                  </Button>
                </FieldGroup>
              </form>
            </Card>
          )}

          {isLoading ? (
            <div className="space-y-4">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-[2rem]" />
              ))}
            </div>
          ) : !jobs?.length ? (
            <Card className="py-0">
              <EmptyState
                icon={<Wrench />}
                title={copy.emptyTitle}
                description={copy.emptyDescription}
              />
            </Card>
          ) : (
            <div className="space-y-5">
              {jobs.map((job, index) => (
                <JobCard key={job.id} job={job} index={index} defaultOpen={index === 0} />
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24">
          <Card tone="dark" className="gap-0 rounded-[2.25rem] px-[22px] pt-[26px] pb-[22px]">
            <h2 className="px-1 text-[1.4375rem] font-medium tracking-tight">
              How maintenance works
            </h2>
            <p className="text-panel-muted px-1 pt-1 pb-5 text-sm leading-snug">
              What happens once a role becomes a job rather than an application.
            </p>
            <ol className="relative flex flex-col gap-3.5 pl-[38px]">
              <span
                aria-hidden
                className="bg-panel-muted/40 absolute top-1.5 bottom-1.5 left-[11px] w-[1.5px]"
              />
              {MAINTENANCE_STEPS(copy.addStep).map((step, index) => (
                <li key={step.title} className="bg-panel-raised relative rounded-3xl p-[18px]">
                  <span className="bg-brand text-brand-foreground absolute top-[18px] -left-[38px] grid size-6 place-items-center rounded-full text-xs font-extrabold tabular-nums">
                    {index + 1}
                  </span>
                  <p className="text-[1.03rem] font-medium">{step.title}</p>
                  <p className="text-panel-muted mt-1 text-[0.84rem] leading-normal">
                    {step.detail}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="gap-0 p-6">
            <div className="mb-[18px] flex items-center gap-3">
              <Tile icon={Lightbulb} size="sm" />
              <h2 className="text-xl font-medium tracking-tight">Tips</h2>
            </div>
            <ul className="space-y-4">
              {MAINTENANCE_TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-3 text-[0.9rem] leading-snug font-medium">
                  <span className="bg-brand text-brand-foreground grid size-[22px] shrink-0 place-items-center rounded-full">
                    <Check className="size-3 stroke-[3]" />
                  </span>
                  {tip}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

const LOGO_TONES = [
  "bg-brand text-brand-foreground",
  "bg-panel text-panel-foreground",
  "bg-info text-white",
  "bg-success text-white",
];

/** A coloured square carrying the employer's initial; the colour follows the card's place in the list. */
function Logo({ name, index }: { name: string; index: number }) {
  const hue = index % LOGO_TONES.length;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-14 shrink-0 place-items-center rounded-[18px] text-[1.375rem] font-extrabold",
        LOGO_TONES[hue],
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function JobCard({
  job,
  index,
  defaultOpen = false,
}: {
  job: Job;
  index: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="gap-0 px-[26px] py-6">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3">
          <Logo name={job.employer_name} index={index} />
          <div className="min-w-0 flex-1 basis-60">
            <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[1.375rem] leading-tight font-semibold tracking-tight">
              {job.employer_name} — {job.role_title}
              <Badge variant={job.status === "active" ? "success" : "secondary"}>
                {job.status}
              </Badge>
            </h3>
            <p className="text-muted-foreground mt-1 text-sm font-medium">
              Started {shortDate(job.start_date)}
              {job.manager_name && ` · reports to ${job.manager_name}`}
              {job.team && ` · ${job.team}`}
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="outline" aria-expanded={open}>
              Meetings
              <ChevronDown
                data-icon="inline-end"
                className="transition-transform data-[state=open]:rotate-180"
                data-state={open ? "open" : "closed"}
              />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="border-border mt-[22px] border-t pt-5">
            <SeriesPanel jobId={job.id} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function SeriesPanel({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["series", jobId],
    queryFn: () => request<Series[]>(`/api/v1/shared/maintained-jobs/${jobId}/series`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["series", jobId] });
    queryClient.invalidateQueries({ queryKey: ["meetings"] });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request(`/api/v1/shared/maintained-jobs/${jobId}/series`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      request(`/api/v1/shared/maintained-jobs/series/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-3.5">
      {data?.map((s) => (
        <div key={s.id} className="bg-soft rounded-[26px] px-[22px] pt-5 pb-[22px]">
          <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2">
            <Tile icon={Repeat} tone={s.is_active ? "brand" : "neutral"} />
            <div className="min-w-0 flex-1 basis-48">
              <p className="flex flex-wrap items-center gap-2.5 text-[1.0625rem] font-semibold">
                {s.title}
                {!s.is_active && <Badge variant="warning">paused</Badge>}
              </p>
              <p className="text-muted-foreground mt-0.5 text-[0.84rem] font-medium tabular-nums">
                {RECURRENCE_OPTIONS.find(([r]) => r === s.recurrence_rule)?.[1] ??
                  s.recurrence_rule}{" "}
                at {s.start_time_local} · {s.duration_min} min
              </p>
            </div>
            <span className="text-muted-foreground pt-3 text-sm font-medium">
              materialised through {s.materialized_through ? shortDate(s.materialized_through) : "—"}
            </span>
            <Button
              variant="outline"
              size="xs"
              className="mt-2"
              onClick={() => update.mutate({ id: s.id, body: { is_active: !s.is_active } })}
            >
              {s.is_active ? <Pause /> : <Play />}
              {s.is_active ? "Pause" : "Resume"}
            </Button>
          </div>
          <FormField label="Standing preparation" className="mt-4">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                className="bg-card min-h-[72px]"
                defaultValue={s.preparation_template ?? ""}
                onBlur={(e) =>
                  update.mutate({
                    id: s.id,
                    body: { preparation_template: e.target.value },
                  })
                }
              />
            )}
          </FormField>
        </div>
      ))}

      <form
        className="rounded-[26px] px-[22px] pt-5 pb-[22px] shadow-[inset_0_0_0_1.5px_var(--border)]"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            title: f.get("title"),
            recurrence_rule: f.get("recurrence_rule"),
            start_date: f.get("start_date"),
            start_time_local: f.get("start_time_local"),
            duration_min: Number(f.get("duration_min")),
          });
          e.currentTarget.reset();
        }}
      >
        <FieldGroup>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-[1.15fr_1.25fr_1fr_0.8fr]">
            <FormField label="Title">
              {(control) => (
                <Input {...control} name="title" required placeholder="Team standup" />
              )}
            </FormField>
            <RecurrenceField />
            <FormField label="From">
              {(control) => <Input {...control} name="start_date" type="date" required />}
            </FormField>
            <FormField label="Time (Eastern)">
              {(control) => (
                <Input
                  {...control}
                  name="start_time_local"
                  type="time"
                  required
                  defaultValue="10:00"
                />
              )}
            </FormField>
          </div>
          <input type="hidden" name="duration_min" value="30" />
          <Button
            type="submit"
            variant="outline"
            className="self-start"
            disabled={create.isPending}
          >
            {create.isPending ? <Spinner /> : <Plus />}
            Add recurring meeting
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}

/**
 * Radix Select is not a <select>, so it does not appear in FormData. The value
 * is mirrored into a hidden input under the same name the form reads.
 */
function RecurrenceField() {
  const [value, setValue] = useState(RECURRENCE_OPTIONS[0][0]);
  return (
    <Field>
      <FieldLabel htmlFor="recurrence_rule">Repeats</FieldLabel>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id="recurrence_rule" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RECURRENCE_OPTIONS.map(([option, label]) => (
            <SelectItem key={option} value={option}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name="recurrence_rule" value={value} />
    </Field>
  );
}
