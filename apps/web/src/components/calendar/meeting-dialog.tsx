"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { currentStage, type ApplicationRow } from "@/components/applications/shared";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";
import {
  dayLabel,
  durationMinutes,
  minutesInto,
  minutesLabel,
  todayKey,
  zoneAbbreviation,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";
import { formatDay } from "@/lib/format";
import { invalidateSchedule, MEETING_STATUSES, meetingStatus } from "@/lib/schedule";

export interface MeetingDraft {
  /** Book it for this interview stage; the application is found from it. */
  stageId?: string;
  maintainedJobId?: string;
  date?: DayKey;
  /** Minutes after local midnight in the display zone. */
  minutes?: number;
  duration?: number;
}

export type MeetingDialogState =
  | { mode: "create"; draft: MeetingDraft }
  | { mode: "edit"; meeting: Meeting }
  | null;

interface Job {
  id: string;
  employer_name: string;
  role_title: string;
  status: string;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const REMINDERS: [number, string][] = [
  [0, "No reminder"],
  [10, "10 minutes before"],
  [15, "15 minutes before"],
  [30, "30 minutes before"],
  [60, "1 hour before"],
  [1440, "1 day before"],
];
/** Typical length by stage kind — the seeded pipeline's defaults. */
const STAGE_DURATION: Record<string, number> = {
  recruiter_screen: 30,
  hiring_manager: 45,
  technical_screen: 60,
  system_design: 60,
  panel_onsite: 90,
  offer: 30,
};
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** The next whole hour today, or mid-morning on any other day. */
function defaultStart(day: DayKey): number {
  if (day !== todayKey()) return 10 * 60;
  return Math.min(Math.ceil((minutesInto(new Date().toISOString()) + 1) / 60) * 60, 23 * 60);
}

/**
 * Schedule a meeting, or edit one — the single form behind every "schedule"
 * and "edit" button, so the tracking table and the calendar cannot drift.
 */
export function MeetingDialog({
  state,
  onClose,
}: {
  state: MeetingDialogState;
  onClose: () => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {state && (
          <MeetingForm
            key={state.mode === "edit" ? state.meeting.id : JSON.stringify(state.draft)}
            state={state}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MeetingForm({
  state,
  onClose,
}: {
  state: NonNullable<MeetingDialogState>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = state.mode === "edit" ? state.meeting : null;
  const draft: MeetingDraft = state.mode === "create" ? state.draft : {};

  const applications = useQuery({
    queryKey: ["applications", "all"],
    queryFn: () => request<{ items: ApplicationRow[] }>("/api/v1/applications"),
    enabled: !editing,
  });
  const jobs = useQuery({
    queryKey: ["maintained-jobs"],
    queryFn: () => request<Job[]>("/api/v1/maintained-jobs"),
    enabled: !editing,
  });

  const rows = useMemo(() => applications.data?.items ?? [], [applications.data]);
  const [target, setTarget] = useState(
    draft.maintainedJobId ? `job:${draft.maintainedJobId}` : "",
  );
  const [stageId, setStageId] = useState(draft.stageId ?? "");
  const stageOwner = stageId
    ? rows.find((row) => row.stages.some((s) => s.id === stageId))
    : undefined;
  const effectiveTarget = target || (stageOwner ? `app:${stageOwner.id}` : "");
  const app = rows.find((row) => `app:${row.id}` === effectiveTarget);
  const job = jobs.data?.find((j) => `job:${j.id}` === effectiveTarget);
  const stage = app?.stages.find((s) => s.id === stageId);

  const initialDate = draft.date ?? todayKey();
  const [date, setDate] = useState(editing ? formatDay(editing.starts_at) : initialDate);
  const [time, setTime] = useState(
    minutesLabel(
      editing ? minutesInto(editing.starts_at) : (draft.minutes ?? defaultStart(initialDate)),
    ),
  );
  // Zero means "not chosen": the stage's usual length applies until it is.
  const [duration, setDuration] = useState(
    editing ? durationMinutes(editing) : (draft.duration ?? 0),
  );
  const [title, setTitle] = useState(editing?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(Boolean(editing));
  const [location, setLocation] = useState(editing?.location ?? "");
  const [link, setLink] = useState(editing?.conferencing_url ?? "");
  const [reminder, setReminder] = useState(editing?.reminder_minutes ?? 30);
  const [status, setStatus] = useState(editing?.status ?? "scheduled");
  const [agenda, setAgenda] = useState(editing?.agenda ?? "");
  const [prep, setPrep] = useState(editing?.preparation_notes ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const suggestedTitle =
    stage && app
      ? `${stage.name} — ${app.company_name}`
      : job
        ? `${job.employer_name} — team sync`
        : "";
  const titleValue = titleTouched ? title : suggestedTitle;
  const length = duration || (stage && STAGE_DURATION[stage.kind]) || 30;
  const validDate = DATE_PATTERN.test(date);
  const validTime = TIME_PATTERN.test(time);
  const start = validTime ? toMinutes(time) : 0;
  const end = start + length;
  const durationOptions = DURATIONS.includes(length)
    ? DURATIONS
    : [...DURATIONS, length].sort((a, b) => a - b);

  const sameDay = useQuery({
    queryKey: ["meetings", date, date],
    queryFn: () => request<Meeting[]>(`/api/v1/meetings?from=${date}&to=${date}`),
    enabled: validDate,
  });
  const conflicts = useMemo(
    () =>
      (sameDay.data ?? []).filter((m) => {
        if (m.id === editing?.id || m.status === "cancelled") return false;
        const from = minutesInto(m.starts_at);
        return from < end && from + durationMinutes(m) > start;
      }),
    [sameDay.data, editing?.id, start, end],
  );

  const finish = () => {
    invalidateSchedule(queryClient);
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      if (!editing) {
        return request<Meeting>("/api/v1/meetings", {
          method: "POST",
          body: JSON.stringify({
            title: titleValue.trim(),
            local_date: date,
            local_time: time,
            duration_min: length,
            meeting_type: stage?.kind ?? "team_sync",
            stage_id: stage?.id ?? null,
            maintained_job_id: job?.id ?? null,
            location: location.trim() || null,
            conferencing_url: link.trim() || null,
            agenda: agenda.trim() || null,
            preparation_notes: prep.trim() || null,
            reminder_minutes: reminder,
          }),
        });
      }
      // Send only what changed: a moved time must not also re-save notes
      // somebody edited in another tab.
      const body: Record<string, unknown> = {};
      const changed = (key: string, next: unknown, previous: unknown) => {
        if (next !== previous) body[key] = next;
      };
      changed("title", titleValue.trim(), editing.title);
      changed("local_date", date, formatDay(editing.starts_at));
      changed("local_time", time, minutesLabel(minutesInto(editing.starts_at)));
      changed("duration_min", length, durationMinutes(editing));
      changed("status", status, editing.status);
      changed("location", location.trim() || null, editing.location);
      changed("conferencing_url", link.trim() || null, editing.conferencing_url);
      changed("agenda", agenda.trim() || null, editing.agenda);
      changed("preparation_notes", prep.trim() || null, editing.preparation_notes);
      changed("notes", notes.trim() || null, editing.notes);
      changed("reminder_minutes", reminder, editing.reminder_minutes);
      if (!Object.keys(body).length) return Promise.resolve(editing);
      return request<Meeting>(`/api/v1/meetings/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: finish,
  });

  const remove = useMutation({
    mutationFn: () => request(`/api/v1/meetings/${editing!.id}`, { method: "DELETE" }),
    onSuccess: finish,
  });

  function pickTarget(value: string) {
    setTarget(value);
    const picked = rows.find((row) => `app:${row.id}` === value);
    setStageId(picked ? ((currentStage(picked.stages) ?? picked.stages[0])?.id ?? "") : "");
  }

  const needsOwner = !editing && !stage && !job;
  const invalid = !titleValue.trim() || !validDate || !validTime || needsOwner;
  const error = (save.error ?? remove.error) as Error | null;
  const nothingToBook =
    !editing &&
    applications.isSuccess &&
    jobs.isSuccess &&
    !rows.length &&
    !(jobs.data ?? []).length;
  const owner = editing
    ? [editing.company_name, editing.stage_name].filter(Boolean).join(" · ")
    : "";

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit meeting" : "Schedule a meeting"}</DialogTitle>
        <DialogDescription>
          {owner ||
            `Times are in ${validDate ? zoneAbbreviation(date) : "your display zone"}.`}
        </DialogDescription>
      </DialogHeader>

      {nothingToBook ? (
        <p className="text-muted-foreground text-sm">
          Meetings belong to an application or a current job.{" "}
          <Link href="/applications" className="text-primary hover:underline">
            Add an application
          </Link>{" "}
          first.
        </p>
      ) : (
        <FieldGroup className="gap-4">
          {!editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="For">
                {(control) => (
                  <Select value={effectiveTarget} onValueChange={pickTarget}>
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue placeholder="Pick an application or job" />
                    </SelectTrigger>
                    <SelectContent>
                      {rows.map((row) => (
                        <SelectItem key={row.id} value={`app:${row.id}`}>
                          {row.company_name} — {row.role_title}
                        </SelectItem>
                      ))}
                      {(jobs.data ?? []).map((j) => (
                        <SelectItem key={j.id} value={`job:${j.id}`}>
                          Job · {j.employer_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              {app && (
                <FormField label="Interview step">
                  {(control) => (
                    <Select value={stageId} onValueChange={setStageId}>
                      <SelectTrigger {...control} className="w-full">
                        <SelectValue placeholder="Pick a step" />
                      </SelectTrigger>
                      <SelectContent>
                        {app.stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
            </div>
          )}

          <FormField label="Title">
            {(control) => (
              <Input
                {...control}
                value={titleValue}
                placeholder="Recruiter screen"
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleTouched(true);
                }}
              />
            )}
          </FormField>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <FormField label="Date">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Start">
                {(control) => (
                  <Input
                    {...control}
                    type="time"
                    step={300}
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Length" className="col-span-2 sm:col-span-1">
                {(control) => (
                  <Select
                    value={String(length)}
                    onValueChange={(value) => setDuration(Number(value))}
                  >
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {durationOptions.map((minutes) => (
                        <SelectItem key={minutes} value={String(minutes)}>
                          {minutes < 60 || minutes % 60
                            ? `${minutes} min`
                            : `${minutes / 60} h`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
            {validDate && validTime && (
              <p className="text-muted-foreground text-xs tabular-nums">
                {dayLabel(date, "EEEE d MMMM")} · {time} – {minutesLabel(end)}{" "}
                {zoneAbbreviation(date)}
              </p>
            )}
            {conflicts.length > 0 && (
              <p className="text-warning flex items-start gap-1.5 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Overlaps{" "}
                  {conflicts
                    .map((m) => `${m.title} (${minutesLabel(minutesInto(m.starts_at))})`)
                    .join(", ")}
                </span>
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Meeting link">
              {(control) => (
                <Input
                  {...control}
                  inputMode="url"
                  placeholder="https://zoom.us/j/…"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Location">
              {(control) => (
                <Input
                  {...control}
                  placeholder="Phone, office address…"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Reminder">
              {(control) => (
                <Select
                  value={String(reminder)}
                  onValueChange={(value) => setReminder(Number(value))}
                >
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REMINDERS.map(([minutes, label]) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            {editing && (
              <FormField label="Status">
                {(control) => (
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEETING_STATUSES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {meetingStatus(value).label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          </div>

          <FormField label="Agenda">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                placeholder="Who you are meeting and what they want to cover"
                value={agenda}
                onChange={(event) => setAgenda(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Preparation">
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                placeholder="Stories to tell, questions to ask, things to look up"
                value={prep}
                onChange={(event) => setPrep(event.target.value)}
              />
            )}
          </FormField>
          {editing && (
            <FormField label="Notes">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  placeholder="What was asked, how it went, follow-ups"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              )}
            </FormField>
          )}
        </FieldGroup>
      )}

      {error && <p className="text-destructive text-sm">{error.message}</p>}

      <DialogFooter className="gap-2 sm:justify-between">
        {editing ? (
          confirmDelete ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending && <Spinner />}
                {editing.series_id ? "Skip this occurrence" : "Delete for good"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Delete
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={invalid || save.isPending || nothingToBook}>
            {save.isPending && <Spinner />}
            {editing ? "Save changes" : "Schedule"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
