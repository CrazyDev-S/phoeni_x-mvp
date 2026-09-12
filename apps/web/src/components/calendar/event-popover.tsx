"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { FormField } from "@/components/form-field";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
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
import {
  dayLabel,
  durationMinutes,
  eventColor,
  minutesInto,
  minutesLabel,
  type Meeting,
} from "@/lib/calendar";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUSES = ["scheduled", "held", "cancelled", "rescheduled", "no_show"];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const STATUS_TONE: Record<string, Tone> = {
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
    left = Math.min(
      Math.max(left, MARGIN),
      Math.max(viewportWidth - WIDTH - MARGIN, MARGIN),
    );

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
        className={cn(
          "bg-popover text-popover-foreground fixed z-50 max-h-[80vh] overflow-y-auto rounded-xl border shadow-lg",
          !position && "invisible",
        )}
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
            <p className="text-base leading-snug font-medium break-words">
              {meeting.title}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {dayLabel(formatDay(meeting.starts_at), "EEEE d MMMM")} ·{" "}
              {minutesLabel(start)} – {minutesLabel(start + duration)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-1 shrink-0 rounded-full"
          >
            <X />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
          <StatusBadge
            tone={STATUS_TONE[meeting.status] ?? "neutral"}
            className="capitalize"
          >
            {meeting.status.replace("_", " ")}
          </StatusBadge>
          <StatusBadge tone="neutral" className="capitalize">
            {meeting.meeting_type.replace(/_/g, " ")}
          </StatusBadge>
          {meeting.series_id && (
            <StatusBadge tone="neutral">
              recurring{meeting.is_exception ? ", edited" : ""}
            </StatusBadge>
          )}
          {pending && <Spinner className="text-muted-foreground" />}
        </div>

        {(meeting.location || meeting.conferencing_url) && (
          <div className="space-y-1 px-4 pt-3 text-sm">
            {meeting.location && (
              <p className="text-muted-foreground">{meeting.location}</p>
            )}
            {meeting.conferencing_url && (
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <a href={meeting.conferencing_url} target="_blank" rel="noreferrer">
                  Join call
                </a>
              </Button>
            )}
          </div>
        )}

        <div className="p-4">
          <FieldGroup className="gap-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Date">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={formatDay(meeting.starts_at)}
                    onChange={(event) => onPatch({ local_date: event.target.value })}
                  />
                )}
              </FormField>
              <FormField label="Time">
                {(control) => (
                  <Input
                    {...control}
                    type="time"
                    value={minutesLabel(start)}
                    onChange={(event) => onPatch({ local_time: event.target.value })}
                  />
                )}
              </FormField>
              <FormField label="Duration">
                {(control) => (
                  <Select
                    value={String(duration)}
                    onValueChange={(value) => onPatch({ duration_min: Number(value) })}
                  >
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(DURATIONS.includes(duration)
                        ? DURATIONS
                        : [...DURATIONS, duration].sort((a, b) => a - b)
                      ).map((minutes) => (
                        <SelectItem key={minutes} value={String(minutes)}>
                          {minutes} min
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="Status">
                {(control) => (
                  <Select
                    value={meeting.status}
                    onValueChange={(value) => onPatch({ status: value })}
                  >
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((status) => (
                        <SelectItem key={status} value={status} className="capitalize">
                          {status.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>

            {meeting.agenda && (
              <FormField label="Agenda">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    key={`agenda-${meeting.id}`}
                    defaultValue={meeting.agenda ?? ""}
                    onBlur={(event) => onPatch({ agenda: event.target.value })}
                  />
                )}
              </FormField>
            )}
            <FormField label="Preparation">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  key={`prep-${meeting.id}`}
                  defaultValue={meeting.preparation_notes ?? ""}
                  onBlur={(event) => onPatch({ preparation_notes: event.target.value })}
                />
              )}
            </FormField>
            <FormField label="Notes">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  key={`notes-${meeting.id}`}
                  defaultValue={meeting.notes ?? ""}
                  onBlur={(event) => onPatch({ notes: event.target.value })}
                />
              )}
            </FormField>
          </FieldGroup>
        </div>
      </div>
    </>
  );
}
