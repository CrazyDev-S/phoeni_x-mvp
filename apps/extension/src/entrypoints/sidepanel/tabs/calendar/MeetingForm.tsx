import { AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  clock,
  dayLabel,
  durationMinutes,
  lengthLabel,
  MEETING_STATUSES,
  statusLabel,
  todayKey,
  toMinutes,
  zoneAbbreviation,
  zoned,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";
import { ErrorNote, PanelField } from "../../components";

export type MeetingFormState =
  | { mode: "create"; date: DayKey }
  | { mode: "edit"; meeting: Meeting };

interface Stage {
  id: string;
  name: string;
  kind: string;
  status: string;
}

interface Application {
  id: string;
  company_name: string;
  role_title: string;
  stages: Stage[];
}

interface Job {
  id: string;
  employer_name: string;
  role_title: string;
}

interface Track {
  id: string;
  job: { title: string };
}

interface Owners {
  applications: Application[];
  jobs: Job[];
  tracks: Track[];
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const REMINDERS: [number, string][] = [
  [0, "No reminder"],
  [10, "10 min before"],
  [15, "15 min before"],
  [30, "30 min before"],
  [60, "1 hour before"],
  [1440, "1 day before"],
];
/** Typical length by stage kind - the seeded pipeline's defaults. */
const STAGE_DURATION: Record<string, number> = {
  recruiter_screen: 30,
  hiring_manager: 45,
  technical_screen: 60,
  system_design: 60,
  panel_onsite: 90,
  offer: 30,
};
// Still ahead of the candidate; the first is "where they are" in the pipeline.
const OPEN_STAGE_STATUSES = new Set([
  "pending",
  "scheduled",
  "in_progress",
  "waiting_feedback",
  "rescheduled",
  "no_show",
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

function currentStage(stages: Stage[]): Stage | undefined {
  return stages.find((s) => s.kind !== "applied" && OPEN_STAGE_STATUSES.has(s.status));
}

/** The next whole hour today, or mid-morning on any other day. */
function defaultStart(day: DayKey, timeZone: string): number {
  if (day !== todayKey(timeZone)) return 10 * 60;
  return Math.min(Math.ceil((zoned(new Date(), timeZone).minutes + 1) / 60) * 60, 23 * 60);
}

/**
 * Schedule a meeting, or edit one - the portal's meeting form, fitted to the
 * panel. A meeting belongs to an interview step, a current job or a bid, as it
 * does there.
 */
export function MeetingForm({
  state,
  timeZone,
  portalUrl,
  onSaved,
  onCancel,
}: {
  state: MeetingFormState;
  timeZone: string;
  portalUrl: string;
  onSaved: (day: DayKey) => void;
  onCancel: () => void;
}) {
  const editing = state.mode === "edit" ? state.meeting : null;
  const initialDate = state.mode === "create" ? state.date : zoned(state.meeting.starts_at, timeZone).day;

  const [owners, setOwners] = useState<Owners | null>(null);
  const [target, setTarget] = useState("");
  const [stageId, setStageId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(() =>
    clock(editing ? zoned(editing.starts_at, timeZone).minutes : defaultStart(initialDate, timeZone)),
  );
  // Zero means "not chosen": the step's usual length applies until it is.
  const [duration, setDuration] = useState(editing ? durationMinutes(editing) : 0);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(Boolean(editing));
  const [link, setLink] = useState(editing?.conferencing_url ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [reminder, setReminder] = useState(editing?.reminder_minutes ?? 30);
  const [status, setStatus] = useState(editing?.status ?? "scheduled");
  const [agenda, setAgenda] = useState(editing?.agenda ?? "");
  const [prep, setPrep] = useState(editing?.preparation_notes ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [sameDay, setSameDay] = useState<Meeting[]>([]);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    void Promise.all([
      api<{ items: Application[] }>("/api/v1/remote/applications?limit=300")
        .then((r) => r.items)
        .catch(() => [] as Application[]),
      api<Job[]>("/api/v1/shared/maintained-jobs").catch(() => [] as Job[]),
      api<Track[]>("/api/v1/freelancing/tracks?include_closed=false").catch(() => [] as Track[]),
    ]).then(([applications, jobs, tracks]) => setOwners({ applications, jobs, tracks }));
  }, [editing]);

  const validDate = DATE_PATTERN.test(date);
  const validTime = TIME_PATTERN.test(time);

  useEffect(() => {
    if (!validDate) return;
    let live = true;
    api<Meeting[]>(`/api/v1/shared/meetings?from=${date}&to=${date}`)
      .then((list) => live && setSameDay(list))
      .catch(() => live && setSameDay([]));
    return () => {
      live = false;
    };
  }, [date, validDate]);

  const app = owners?.applications.find((a) => `app:${a.id}` === target);
  const job = owners?.jobs.find((j) => `job:${j.id}` === target);
  const track = owners?.tracks.find((t) => `track:${t.id}` === target);
  const stage = app?.stages.find((s) => s.id === stageId);

  const suggestedTitle = stage && app
    ? `${stage.name} — ${app.company_name}`
    : job
      ? `${job.employer_name} — team sync`
      : track
        ? `Client call — ${track.job.title}`
        : "";
  const titleValue = titleTouched ? title : suggestedTitle;
  const length = duration || (stage && STAGE_DURATION[stage.kind]) || 30;
  const start = validTime ? toMinutes(time) : 0;
  const end = start + length;
  const durationOptions = DURATIONS.includes(length)
    ? DURATIONS
    : [...DURATIONS, length].sort((a, b) => a - b);

  const conflicts = useMemo(
    () =>
      sameDay.filter((m) => {
        if (m.id === editing?.id || m.status === "cancelled") return false;
        const from = zoned(m.starts_at, timeZone).minutes;
        return from < end && from + durationMinutes(m) > start;
      }),
    [sameDay, editing?.id, timeZone, start, end],
  );

  const nothingToBook =
    !editing &&
    owners !== null &&
    !owners.applications.length &&
    !owners.jobs.length &&
    !owners.tracks.length;
  const needsOwner = !editing && !stage && !job && !track;
  const invalid = !titleValue.trim() || !validDate || !validTime || needsOwner;

  function pickTarget(value: string) {
    setTarget(value);
    const picked = owners?.applications.find((a) => `app:${a.id}` === value);
    setStageId(picked ? ((currentStage(picked.stages) ?? picked.stages[0])?.id ?? "") : "");
  }

  async function save() {
    if (invalid) return;
    setBusy("save");
    setError(null);
    try {
      if (!editing) {
        await api("/api/v1/shared/meetings", {
          method: "POST",
          body: JSON.stringify({
            title: titleValue.trim(),
            local_date: date,
            local_time: time,
            duration_min: length,
            meeting_type: stage?.kind ?? (track ? "client_call" : "team_sync"),
            stage_id: stage?.id ?? null,
            maintained_job_id: job?.id ?? null,
            freelance_track_id: track?.id ?? null,
            location: location.trim() || null,
            conferencing_url: link.trim() || null,
            agenda: agenda.trim() || null,
            preparation_notes: prep.trim() || null,
            reminder_minutes: reminder,
          }),
        });
      } else {
        // Only what changed: a moved time must not also re-save notes edited
        // somewhere else meanwhile.
        const body: Record<string, unknown> = {};
        const changed = (key: string, next: unknown, previous: unknown) => {
          if (next !== previous) body[key] = next;
        };
        const was = zoned(editing.starts_at, timeZone);
        changed("title", titleValue.trim(), editing.title);
        changed("local_date", date, was.day);
        changed("local_time", time, clock(was.minutes));
        changed("duration_min", length, durationMinutes(editing));
        changed("status", status, editing.status);
        changed("location", location.trim() || null, editing.location);
        changed("conferencing_url", link.trim() || null, editing.conferencing_url);
        changed("agenda", agenda.trim() || null, editing.agenda);
        changed("preparation_notes", prep.trim() || null, editing.preparation_notes);
        changed("notes", notes.trim() || null, editing.notes);
        changed("reminder_minutes", reminder, editing.reminder_minutes);
        if (Object.keys(body).length) {
          await api(`/api/v1/shared/meetings/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
        }
      }
      onSaved(date);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy("delete");
    setError(null);
    try {
      await api(`/api/v1/shared/meetings/${editing.id}`, { method: "DELETE" });
      onSaved(initialDate);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const owner = editing
    ? [editing.company_name, editing.stage_name].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label="Back to the calendar" onClick={onCancel}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{editing ? "Edit meeting" : "Schedule a meeting"}</h2>
          <p className="text-muted-foreground truncate text-[11px]">
            {owner || `Times in ${zoneAbbreviation(validDate ? date : initialDate, timeZone)}`}
          </p>
        </div>
      </div>

      <Card className="py-3">
        <CardContent className="px-3">
          {!editing && owners === null ? (
            <div className="space-y-3" aria-busy>
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : nothingToBook ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              A meeting belongs to an application, a current job or a bid.{" "}
              <a
                href={`${portalUrl}/remote/applications`}
                target="_blank"
                rel="noreferrer"
                className="text-primary font-medium hover:underline"
              >
                Add an application
              </a>{" "}
              first, or save one from the Apply tab.
            </p>
          ) : (
            <FieldGroup className="gap-3">
              {!editing && owners && (
                <>
                  <PanelField label="For">
                    {(control) => (
                      <Select value={target} onValueChange={pickTarget}>
                        <SelectTrigger {...control} className="w-full">
                          <SelectValue placeholder="Pick an application or job" />
                        </SelectTrigger>
                        <SelectContent>
                          {owners.applications.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Applications</SelectLabel>
                              {owners.applications.map((a) => (
                                <SelectItem key={a.id} value={`app:${a.id}`}>
                                  {a.company_name} — {a.role_title}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          {owners.jobs.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Current jobs</SelectLabel>
                              {owners.jobs.map((j) => (
                                <SelectItem key={j.id} value={`job:${j.id}`}>
                                  {j.employer_name} — {j.role_title}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          {owners.tracks.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Freelance bids</SelectLabel>
                              {owners.tracks.map((t) => (
                                <SelectItem key={t.id} value={`track:${t.id}`}>
                                  {t.job.title}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </PanelField>

                  {app && (
                    <PanelField label="Interview step">
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
                    </PanelField>
                  )}
                </>
              )}

              <PanelField label="Title">
                {(control) => (
                  <Input
                    {...control}
                    value={titleValue}
                    placeholder="Recruiter screen"
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setTitleTouched(true);
                    }}
                  />
                )}
              </PanelField>

              <div className="grid grid-cols-2 gap-2">
                <PanelField label="Date">
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  )}
                </PanelField>
                <PanelField label="Start">
                  {(control) => (
                    <Input
                      {...control}
                      type="time"
                      step={300}
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  )}
                </PanelField>
                <PanelField label="Length">
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
                            {lengthLabel(minutes)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </PanelField>
                <PanelField label="Reminder">
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
                </PanelField>
              </div>

              {validDate && validTime && (
                <p className="bg-muted/60 text-muted-foreground -mt-1 rounded-md px-2 py-1.5 text-[11px] tabular-nums">
                  {dayLabel(date, { weekday: "long", day: "numeric", month: "long" })} ·{" "}
                  {time} – {clock(end)} {zoneAbbreviation(date, timeZone)}
                </p>
              )}
              {conflicts.length > 0 && (
                <p className="text-warning -mt-1 flex items-start gap-1.5 text-[11px] leading-snug">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  <span>
                    Overlaps{" "}
                    {conflicts
                      .map((m) => `${m.title} (${clock(zoned(m.starts_at, timeZone).minutes)})`)
                      .join(", ")}
                  </span>
                </p>
              )}

              <PanelField label="Meeting link">
                {(control) => (
                  <Input
                    {...control}
                    inputMode="url"
                    placeholder="https://zoom.us/j/…"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                  />
                )}
              </PanelField>
              <PanelField label="Location">
                {(control) => (
                  <Input
                    {...control}
                    placeholder="Phone, office address…"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                )}
              </PanelField>

              {editing && (
                <PanelField label="Status">
                  {(control) => (
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger {...control} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MEETING_STATUSES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {statusLabel(value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </PanelField>
              )}

              <PanelField label="Agenda">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={2}
                    placeholder="Who you are meeting and what they want to cover"
                    value={agenda}
                    onChange={(e) => setAgenda(e.target.value)}
                  />
                )}
              </PanelField>
              <PanelField label="Preparation">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    placeholder="Stories to tell, questions to ask, things to look up"
                    value={prep}
                    onChange={(e) => setPrep(e.target.value)}
                  />
                )}
              </PanelField>
              {editing && (
                <PanelField label="Notes">
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      placeholder="What was asked, how it went, follow-ups"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  )}
                </PanelField>
              )}
            </FieldGroup>
          )}
        </CardContent>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-1.5">
        {editing &&
          (confirmDelete ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={() => void remove()}
              >
                {busy === "delete" && <Spinner />}
                {editing.series_id ? "Skip this one" : "Delete for good"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Delete
            </Button>
          ))}
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={invalid || busy !== null || nothingToBook}
            onClick={() => void save()}
          >
            {busy === "save" && <Spinner />}
            {editing ? "Save" : "Schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
