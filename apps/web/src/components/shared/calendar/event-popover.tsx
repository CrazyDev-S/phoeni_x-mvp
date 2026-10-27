"use client";

import {
  Briefcase,
  Check,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  dayLabel,
  durationMinutes,
  eventColor,
  minutesInto,
  spanLabel,
  zoneAbbreviation,
  type Meeting,
} from "@/lib/calendar";
import { formatDay } from "@/lib/format";
import { humanize, meetingStatus } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const MARGIN = 8;
// A scheduled meeting reads blue here, as in every calendar; the brand pill is for actions.
const STATUS_VARIANT = {
  brand: "info",
  ok: "success",
  warn: "warning",
  bad: "destructive",
  neutral: "secondary",
} as const;
const WIDTH = 300;

/**
 * The quick look, anchored to whichever block was clicked.
 *
 * It answers "what is this and what do I do now" — join, mark it held, cancel,
 * delete — and hands anything longer to the edit dialog.
 */
export function EventPopover({
  meeting,
  anchor,
  pending,
  onPatch,
  onEdit,
  onDelete,
  onClose,
}: {
  meeting: Meeting;
  anchor: DOMRect;
  pending: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const color = eventColor(meeting.meeting_type);
  const start = minutesInto(meeting.starts_at);
  const duration = durationMinutes(meeting);
  const day = formatDay(meeting.starts_at);
  const status = meetingStatus(meeting.status);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { height } = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Left of the meeting when there is room, flipped to its right when
    // there is not, and never off the edge of the screen.
    let left = anchor.left - WIDTH - MARGIN;
    if (left < MARGIN) left = anchor.right + MARGIN;
    left = Math.min(
      Math.max(left, MARGIN),
      Math.max(viewportWidth - WIDTH - MARGIN, MARGIN),
    );

    const top = Math.min(
      Math.max(anchor.top - 8, MARGIN),
      Math.max(viewportHeight - height - MARGIN, MARGIN),
    );
    setPosition({ top, left });
  }, [anchor, meeting.id, confirmDelete]);

  useEffect(() => setConfirmDelete(false), [meeting.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portalled to the body: the page's entrance animation leaves a transform on
  // an ancestor, and a transform turns `position: fixed` into "fixed to that
  // ancestor" - which pushed the bubble off the bottom once the page scrolled.
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label={meeting.title}
        className={cn(
          "bg-popover text-popover-foreground fixed z-50 max-h-[85vh] overflow-y-auto rounded-lg border p-3 shadow-lg",
          !position && "invisible",
        )}
        style={{
          width: WIDTH,
          maxWidth: "calc(100vw - 24px)",
          top: position?.top ?? 0,
          left: position?.left ?? 0,
        }}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-1 size-3 shrink-0 rounded-[3px]"
            style={{ backgroundColor: color.fill }}
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm leading-tight font-semibold break-words",
                meeting.status === "cancelled" && "line-through",
              )}
            >
              {meeting.title}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit"
            onClick={onEdit}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        <p className="text-muted-foreground mt-0.5 ml-5 text-xs tabular-nums">
          {dayLabel(day, "EEEE d MMMM")} · {spanLabel(start, start + duration)}{" "}
          {zoneAbbreviation(day)}
        </p>

        <div className="my-2 flex flex-wrap items-center gap-1">
          <Badge variant={STATUS_VARIANT[status.tone]}>
            {status.label}
          </Badge>
          <Badge variant="secondary">
            {meeting.stage_name ?? humanize(meeting.meeting_type)}
          </Badge>
          {meeting.series_id && (
            <Badge variant="secondary">Recurring{meeting.is_exception ? ", edited" : ""}</Badge>
          )}
          {pending && <Spinner className="text-muted-foreground" />}
        </div>

        <div className="space-y-1.5 text-[13px]">
          {meeting.company_name && (
            <p className="flex items-start gap-2">
              <Briefcase className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="font-semibold">{meeting.company_name}</span>
                {meeting.role_title && (
                  <span className="text-muted-foreground"> · {meeting.role_title}</span>
                )}
                {meeting.application_id && (
                  <Link
                    href={`/remote/applications/${meeting.application_id}`}
                    className="text-brand-ink block text-xs font-medium hover:underline"
                  >
                    Open application
                  </Link>
                )}
                {meeting.track_id && (
                  <Link
                    href={`/freelancing/tracking?open=${meeting.track_id}`}
                    className="text-brand-ink block text-xs font-medium hover:underline"
                  >
                    Open the bid
                  </Link>
                )}
              </span>
            </p>
          )}
          {meeting.location && (
            <p className="text-muted-foreground flex items-start gap-2">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{meeting.location}</span>
            </p>
          )}
          {meeting.conferencing_url && meeting.status === "scheduled" && (
            <Button asChild className="w-full">
              <a href={meeting.conferencing_url} target="_blank" rel="noreferrer">
                <Video className="text-brand" />
                Join call
              </a>
            </Button>
          )}
        </div>

        {(meeting.agenda || meeting.preparation_notes || meeting.notes) && (
          <div className="mt-2 space-y-1.5">
            {(
              [
                ["Agenda", meeting.agenda],
                ["Preparation", meeting.preparation_notes],
                ["Notes", meeting.notes],
              ] as const
            ).map(
              ([label, text]) =>
                text && (
                  <div key={label} className="bg-soft rounded-md px-2.5 py-1.5">
                    <p className="text-muted-foreground mb-0.5 text-[10px] font-semibold tracking-wide uppercase">
                      {label}
                    </p>
                    <p className="line-clamp-5 text-xs leading-snug whitespace-pre-wrap">
                      {text}
                    </p>
                  </div>
                ),
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {meeting.status === "scheduled" ? (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => onPatch({ status: "held" })}
              >
                <Check />
                Mark held
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground"
                disabled={pending}
                onClick={() => onPatch({ status: "cancelled" })}
              >
                Cancel meeting
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => onPatch({ status: "scheduled" })}
            >
              <RotateCcw />
              Back to scheduled
            </Button>
          )}
          {confirmDelete ? (
            <Button
              size="xs"
              variant="destructive"
              className="ml-auto"
              disabled={pending}
              onClick={onDelete}
            >
              {meeting.series_id ? "Skip occurrence?" : "Delete for good?"}
            </Button>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Delete"
              className="text-muted-foreground hover:text-destructive ml-auto"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
