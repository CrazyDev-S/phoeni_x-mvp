"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Badge, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import {
  dayLabel,
  durationMinutes,
  eventColor,
  minutesInto,
  minutesLabel,
  type Meeting,
} from "@/lib/calendar";
import { formatDay } from "@/lib/format";

const STATUSES = ["scheduled", "held", "cancelled", "rescheduled", "no_show"];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "brand"> = {
  scheduled: "brand",
  held: "ok",
  cancelled: "bad",
  rescheduled: "warn",
  no_show: "warn",
};

const MARGIN = 12;
const WIDTH = 344;

/** The detail bubble, anchored to whichever block was clicked. */
export function EventPopover({
  meeting,
  anchor,
  pending,
  onPatch,
  onClose,
}: {
  meeting: Meeting;
  anchor: DOMRect;
  pending: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const color = eventColor(meeting.meeting_type);
  const start = minutesInto(meeting.starts_at);
  const duration = durationMinutes(meeting);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { height } = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Beside the meeting when there is room, flipped to the other side when
    // there is not, and never off the edge of the screen.
    let left = anchor.right + MARGIN;
    if (left + WIDTH > viewportWidth - MARGIN) left = anchor.left - WIDTH - MARGIN;
    left = Math.min(Math.max(left, MARGIN), Math.max(viewportWidth - WIDTH - MARGIN, MARGIN));

    const top = Math.min(
      Math.max(anchor.top - 8, MARGIN),
      Math.max(viewportHeight - height - MARGIN, MARGIN),
    );
    setPosition({ top, left });
  }, [anchor, meeting.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label={meeting.title}
        className={`fixed z-50 max-h-[80vh] overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl ${
          position ? "" : "invisible"
        }`}
        style={{
          width: WIDTH,
          maxWidth: "calc(100vw - 24px)",
          top: position?.top ?? 0,
          left: position?.left ?? 0,
        }}
      >
        <div className="flex items-start gap-2 px-4 pt-4">
          <span
            className="mt-1.5 size-3 shrink-0 rounded-sm"
            style={{ backgroundColor: color.fill }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-base leading-snug font-medium break-words">{meeting.title}</p>
            <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
              {dayLabel(formatDay(meeting.starts_at), "EEEE d MMMM")} · {minutesLabel(start)} –{" "}
              {minutesLabel(start + duration)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current stroke-2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
          <Badge tone={STATUS_TONE[meeting.status] ?? "neutral"}>
            {meeting.status.replace("_", " ")}
          </Badge>
          <Badge>{meeting.meeting_type.replace(/_/g, " ")}</Badge>
          {meeting.series_id && <Badge>recurring{meeting.is_exception ? ", edited" : ""}</Badge>}
          {pending && <Spinner className="text-[var(--color-ink-soft)]" />}
        </div>

        {(meeting.location || meeting.conferencing_url) && (
          <div className="space-y-1 px-4 pt-3 text-sm">
            {meeting.location && (
              <p className="text-[var(--color-ink-soft)]">{meeting.location}</p>
            )}
            {meeting.conferencing_url && (
              <a
                href={meeting.conferencing_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-[var(--color-brand)] underline"
              >
                Join call
              </a>
            )}
          </div>
        )}

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date">
              <Input
                type="date"
                value={formatDay(meeting.starts_at)}
                onChange={(event) => onPatch({ local_date: event.target.value })}
              />
            </Field>
            <Field label="Time">
              <Input
                type="time"
                value={minutesLabel(start)}
                onChange={(event) => onPatch({ local_time: event.target.value })}
              />
            </Field>
            <Field label="Duration">
              <Select
                value={duration}
                onChange={(event) => onPatch({ duration_min: Number(event.target.value) })}
              >
                {(DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b)).map(
                  (minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={meeting.status}
                onChange={(event) => onPatch({ status: event.target.value })}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {meeting.agenda && (
            <Field label="Agenda">
              <Textarea
                rows={3}
                defaultValue={meeting.agenda}
                key={`agenda-${meeting.id}`}
                onBlur={(event) => onPatch({ agenda: event.target.value })}
              />
            </Field>
          )}
          <Field label="Preparation">
            <Textarea
              rows={3}
              key={`prep-${meeting.id}`}
              defaultValue={meeting.preparation_notes ?? ""}
              onBlur={(event) => onPatch({ preparation_notes: event.target.value })}
            />
          </Field>
          <Field label="Notes">
            <Textarea
              rows={3}
              key={`notes-${meeting.id}`}
              defaultValue={meeting.notes ?? ""}
              onBlur={(event) => onPatch({ notes: event.target.value })}
            />
          </Field>
        </div>
      </div>
    </>
  );
}
