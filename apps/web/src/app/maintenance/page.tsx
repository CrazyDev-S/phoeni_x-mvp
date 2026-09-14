"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Lightbulb, Pause, Play, Plus, Wrench } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { NextCallBanner } from "@/components/next-call";
import { PageHero } from "@/components/page-hero";
import { CheckList, SidePanel } from "@/components/side-panel";
import { StepsBand } from "@/components/steps-band";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function MaintenancePage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["maintained-jobs"],
    queryFn: () => request<Job[]>("/api/v1/maintained-jobs"),
  });

  const createJob = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<Job>("/api/v1/maintained-jobs", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["maintained-jobs"] });
    },
  });

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="After the offer"
        eyebrowIcon={Wrench}
        title="Job maintenance"
        description="Roles you have started. Recurring team meetings materialise 90 days ahead so each occurrence can carry its own prep notes."
        actions={
          <Button size="lg" className="h-11" onClick={() => setCreating((v) => !v)}>
            <Plus />
            {creating ? "Cancel" : "Add a job"}
          </Button>
        }
      />

      <NextCallBanner />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {creating && (
            <Card>
              <CardContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    createJob.mutate(Object.fromEntries(f.entries()));
                  }}
                >
                  <FieldGroup>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Employer">
                        {(control) => <Input {...control} name="employer_name" required />}
                      </FormField>
                      <FormField label="Role">
                        {(control) => <Input {...control} name="role_title" required />}
                      </FormField>
                      <FormField label="Start date">
                        {(control) => (
                          <Input {...control} name="start_date" type="date" required />
                        )}
                      </FormField>
                      <FormField label="Manager">
                        {(control) => <Input {...control} name="manager_name" />}
                      </FormField>
                    </div>
                    <Button
                      type="submit"
                      className="self-start"
                      disabled={createJob.isPending}
                    >
                      {createJob.isPending && <Spinner />}
                      Save job
                    </Button>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : !jobs?.length ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={<Wrench />}
                  title="No maintained jobs yet"
                  description="When an application reaches contract signed, promote it here to keep its recurring meetings and notes."
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}

          <StepsBand
            title="How maintenance works"
            description="What happens once a role becomes a job rather than an application."
            steps={[
              {
                title: "Add the job",
                detail: "Employer, role and start date, plus who you report to.",
              },
              {
                title: "Add its recurring meetings",
                detail: "Standups and 1:1s, with a standing preparation note.",
              },
              {
                title: "Prep each occurrence",
                detail: "Every materialised meeting carries its own notes on the calendar.",
              },
            ]}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <SidePanel icon={Lightbulb} title="Tips">
            <CheckList items={MAINTENANCE_TIPS} />
          </SidePanel>
        </aside>
      </div>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-0 py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-start justify-between gap-3 py-4">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {job.employer_name} — {job.role_title}
              <StatusBadge tone={job.status === "active" ? "ok" : "neutral"}>
                {job.status}
              </StatusBadge>
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Started {job.start_date}
              {job.manager_name && ` · reports to ${job.manager_name}`}
              {job.team && ` · ${job.team}`}
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">
              Meetings
              <ChevronDown
                data-icon="inline-end"
                className="transition-transform data-[state=open]:rotate-180"
                data-state={open ? "open" : "closed"}
              />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="border-t py-4">
            <SeriesPanel jobId={job.id} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function SeriesPanel({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["series", jobId],
    queryFn: () => request<Series[]>(`/api/v1/maintained-jobs/${jobId}/series`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["series", jobId] });
    queryClient.invalidateQueries({ queryKey: ["meetings"] });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request(`/api/v1/maintained-jobs/${jobId}/series`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      request(`/api/v1/maintained-jobs/series/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      {data?.map((s) => (
        <div key={s.id} className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{s.title}</span>
            <span className="text-muted-foreground">
              {RECURRENCE_OPTIONS.find(([r]) => r === s.recurrence_rule)?.[1] ??
                s.recurrence_rule}{" "}
              at {s.start_time_local} · {s.duration_min} min
            </span>
            {!s.is_active && <StatusBadge tone="warn">paused</StatusBadge>}
            <span className="text-subtle ml-auto text-xs">
              materialised through {s.materialized_through ?? "—"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => update.mutate({ id: s.id, body: { is_active: !s.is_active } })}
            >
              {s.is_active ? <Pause /> : <Play />}
              {s.is_active ? "Pause" : "Resume"}
            </Button>
          </div>
          <FormField label="Standing preparation">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
