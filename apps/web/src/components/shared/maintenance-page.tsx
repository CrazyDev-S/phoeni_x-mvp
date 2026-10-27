"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pause, Play, Plus, Search, Wrench, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FormField } from "@/components/form-field";
import { PageHero } from "@/components/page-hero";
import { Panel, Toolbar } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    add: "Add a job",
    employer: "Employer",
    role: "Role",
    save: "Save job",
    emptyTitle: "No maintained jobs yet",
    emptyDescription: "Promote an application that reached contract signed.",
    count: (n: number) => (n === 1 ? "Job" : "Jobs"),
  },
  freelancing: {
    add: "Add a contract",
    employer: "Client",
    role: "Contract",
    save: "Save contract",
    emptyTitle: "No contracts yet",
    emptyDescription: "Promote a won bid from the pipeline.",
    count: (n: number) => (n === 1 ? "Contract" : "Contracts"),
  },
} as const;

/** Job maintenance for one portal: only the jobs it won, and new ones are filed under it. */
export function MaintenancePage({ portal }: { portal: PortalId }) {
  const copy = COPY[portal];
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState<string | null>(null);

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
  const seriesOf = new Map((jobs ?? []).map((job, i) => [job.id, seriesQueries[i]?.data]));

  const statuses = useMemo(() => [...new Set((jobs ?? []).map((j) => j.status))], [jobs]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (jobs ?? []).filter(
      (j) =>
        (status === "all" || j.status === status) &&
        (!needle ||
          `${j.employer_name} ${j.role_title} ${j.manager_name ?? ""} ${j.team ?? ""}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [jobs, q, status]);

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
    <div className="space-y-3">
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
          <Button variant="secondary" onClick={() => setCreating((v) => !v)}>
            {creating ? <X /> : <Plus />}
            {creating ? "Cancel" : copy.add}
          </Button>
        }
      />

      {creating && (
        <Panel className="p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              createJob.mutate(Object.fromEntries(f.entries()));
            }}
            className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_9rem_1fr_auto]"
          >
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
            <Button type="submit" variant="brand" disabled={createJob.isPending}>
              {createJob.isPending && <Spinner />}
              {copy.save}
            </Button>
          </form>
        </Panel>
      )}

      <Toolbar>
        <div className="relative w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search"
            aria-label="Search maintained jobs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        {statuses.length > 1 && (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Toolbar>

      {isLoading ? (
        <div className="space-y-1" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : !rows.length ? (
        <Panel>
          <EmptyState
            icon={<Wrench />}
            title={jobs?.length ? "Nothing matches" : copy.emptyTitle}
            description={jobs?.length ? undefined : copy.emptyDescription}
          />
        </Panel>
      ) : (
        <Panel>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8" />
                <TableHead>{copy.employer}</TableHead>
                <TableHead>{copy.role}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Reports to</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Series</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((job) => {
                const expanded = open === job.id;
                const series = seriesOf.get(job.id);
                return (
                  <Fragment key={job.id}>
                    <TableRow
                      className="cursor-pointer"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : job.id)}
                    >
                      <TableCell className="pr-0">
                        <ChevronRight
                          className={cn("text-muted-foreground size-3.5 transition-transform", expanded && "rotate-90")}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{job.employer_name}</TableCell>
                      <TableCell>{job.role_title}</TableCell>
                      <TableCell>
                        <Badge variant={job.status === "active" ? "success" : "secondary"}>{job.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{shortDate(job.start_date)}</TableCell>
                      <TableCell className="text-muted-foreground">{job.manager_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{job.team ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{series ? series.length : "—"}</TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="bg-soft p-3 whitespace-normal">
                          <SeriesPanel jobId={job.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
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
    <div className="space-y-2">
      {data?.map((s) => (
        <div key={s.id} className="bg-card grid gap-2 rounded-md border p-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                {s.title}
                {!s.is_active && <Badge variant="warning">paused</Badge>}
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {RECURRENCE_OPTIONS.find(([r]) => r === s.recurrence_rule)?.[1] ?? s.recurrence_rule} at{" "}
                {s.start_time_local} · {s.duration_min} min · through{" "}
                {s.materialized_through ? shortDate(s.materialized_through) : "—"}
              </p>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={() => update.mutate({ id: s.id, body: { is_active: !s.is_active } })}
            >
              {s.is_active ? <Pause /> : <Play />}
              {s.is_active ? "Pause" : "Resume"}
            </Button>
          </div>
          <Textarea
            aria-label={`Standing preparation for ${s.title}`}
            placeholder="Standing preparation"
            rows={2}
            className="min-h-10"
            defaultValue={s.preparation_template ?? ""}
            onBlur={(e) =>
              update.mutate({
                id: s.id,
                body: { preparation_template: e.target.value },
              })
            }
          />
        </div>
      ))}

      <form
        className="bg-card rounded-md border border-dashed p-2.5"
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
        <FieldGroup className="gap-2">
          <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-[1.15fr_1.25fr_1fr_0.8fr_auto]">
            <FormField label="Title">
              {(control) => <Input {...control} name="title" required placeholder="Team standup" />}
            </FormField>
            <RecurrenceField />
            <FormField label="From">
              {(control) => <Input {...control} name="start_date" type="date" required />}
            </FormField>
            <FormField label="Time (Eastern)">
              {(control) => (
                <Input {...control} name="start_time_local" type="time" required defaultValue="10:00" />
              )}
            </FormField>
            <Button type="submit" variant="outline" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <Plus />}
              Add series
            </Button>
          </div>
          <input type="hidden" name="duration_min" value="30" />
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
