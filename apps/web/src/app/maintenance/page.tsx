"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { NextCallBanner } from "@/components/next-call";
import { Badge, Button, Card, Empty, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { request } from "@/lib/api";

interface Job {
  id: string;
  employer_name: string;
  role_title: string;
  start_date: string;
  manager_name: string | null;
  team: string | null;
  status: string;
  notes_md: string | null;
}

interface Series {
  id: string;
  title: string;
  rrule: string;
  dtstart_date: string;
  dtstart_local: string;
  duration_min: number;
  is_active: boolean;
  materialized_through: string | null;
  preparation_template: string | null;
}

const RRULES = [
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
  const qc = useQueryClient();
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["maintained-jobs"],
    queryFn: () => request<Job[]>("/api/v1/maintained-jobs"),
  });

  const createJob = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<Job>("/api/v1/maintained-jobs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["maintained-jobs"] });
    },
  });

  return (
    <div className="space-y-4">
      <NextCallBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Job maintenance</h1>
          <p className="text-sm text-[var(--color-ink-soft)]">
            Roles you have started. Recurring team meetings materialise 90 days
            ahead so each occurrence can carry its own prep notes.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "Add a job"}
        </Button>
      </div>

      {creating && (
        <Card className="p-5">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              createJob.mutate(Object.fromEntries(f.entries()));
            }}
          >
            <Field label="Employer"><Input name="employer_name" required /></Field>
            <Field label="Role"><Input name="role_title" required /></Field>
            <Field label="Start date"><Input name="start_date" type="date" required /></Field>
            <Field label="Manager"><Input name="manager_name" /></Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" loading={createJob.isPending}>
                Save job
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-[var(--color-ink-soft)]">
            <Spinner /> Loading…
          </div>
        </Card>
      ) : !jobs?.length ? (
        <Card>
          <Empty
            title="No maintained jobs yet"
            body="When an application reaches contract signed, promote it here to keep its recurring meetings and notes."
          />
        </Card>
      ) : (
        jobs.map((job) => (
          <Card
            key={job.id}
            title={
              <span className="flex items-center gap-2">
                {job.employer_name} — {job.role_title}
                <Badge tone={job.status === "active" ? "ok" : "neutral"}>{job.status}</Badge>
              </span>
            }
            action={
              <Button size="sm" onClick={() => setOpenJob(openJob === job.id ? null : job.id)}>
                {openJob === job.id ? "Hide" : "Meetings"}
              </Button>
            }
          >
            <div className="px-4 py-3 text-sm text-[var(--color-ink-soft)]">
              Started {job.start_date}
              {job.manager_name && ` · reports to ${job.manager_name}`}
              {job.team && ` · ${job.team}`}
            </div>
            {openJob === job.id && <SeriesPanel jobId={job.id} />}
          </Card>
        ))
      )}
    </div>
  );
}

function SeriesPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["series", jobId],
    queryFn: () => request<Series[]>(`/api/v1/maintained-jobs/${jobId}/series`),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request(`/api/v1/maintained-jobs/${jobId}/series`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["series", jobId] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      request(`/api/v1/maintained-jobs/series/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["series", jobId] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  return (
    <div className="space-y-4 border-t border-[var(--color-line)] p-4">
      {data?.map((s) => (
        <div key={s.id} className="rounded-md border border-[var(--color-line)] p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{s.title}</span>
            <span className="text-[var(--color-ink-soft)]">
              {RRULES.find(([r]) => r === s.rrule)?.[1] ?? s.rrule} at {s.dtstart_local} ·{" "}
              {s.duration_min} min
            </span>
            {!s.is_active && <Badge>paused</Badge>}
            <span className="ml-auto text-xs text-[var(--color-ink-soft)]">
              materialised through {s.materialized_through ?? "—"}
            </span>
            <Button size="sm" onClick={() => update.mutate({ id: s.id, body: { is_active: !s.is_active } })}>
              {s.is_active ? "Pause" : "Resume"}
            </Button>
          </div>
          <Field label="Standing preparation">
            <Textarea
              rows={2}
              defaultValue={s.preparation_template ?? ""}
              onBlur={(e) =>
                update.mutate({ id: s.id, body: { preparation_template: e.target.value } })
              }
            />
          </Field>
        </div>
      ))}

      <form
        className="grid gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            title: f.get("title"),
            rrule: f.get("rrule"),
            dtstart_date: f.get("dtstart_date"),
            dtstart_local: f.get("dtstart_local"),
            duration_min: Number(f.get("duration_min")),
          });
          e.currentTarget.reset();
        }}
      >
        <Field label="Title"><Input name="title" required placeholder="Team standup" /></Field>
        <Field label="Repeats">
          <Select name="rrule" required>
            {RRULES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="From"><Input name="dtstart_date" type="date" required /></Field>
        <Field label="Time (Eastern)"><Input name="dtstart_local" type="time" required defaultValue="10:00" /></Field>
        <input type="hidden" name="duration_min" value="30" />
        <div className="sm:col-span-4">
          <Button type="submit" loading={create.isPending}>Add recurring meeting</Button>
        </div>
      </form>
    </div>
  );
}
