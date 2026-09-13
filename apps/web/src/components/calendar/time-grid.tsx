"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  clamp,
  dayLabel,
  dayOf,
  durationMinutes,
  eventColor,
  minutesInto,
  minutesLabel,
  placeDay,
  todayKey,
  zoneAbbreviation,
  MINUTES_PER_DAY,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

const HOUR_HEIGHT = 48;
const HEADER_HEIGHT = 56;
const SNAP_MINUTES = 15;
const MIN_COLUMN_WIDTH = 110;
const GUTTER_WIDTH = 56;
const HOURS = Array.from({ length: 23 }, (_, index) => index + 1);
// Under this many pixels of travel, a press is a click rather than a drag.
const DRAG_THRESHOLD = 4;
// The "you are here" line. Red by convention in every calendar, and the
// destructive token is the one red the theme already defines for both modes.
const NOW_LINE = "var(--destructive)";

interface Pointer {
  pointerId: number;
  originX: number;
  originY: number;
  active: boolean;
}

/** Move a meeting, stretch its end, or sweep out a new one. */
type Drag =
  | (Pointer & {
      mode: "move";
      meeting: Meeting;
      dayIndex: number;
      duration: number;
      targetDayIndex: number;
      targetMinutes: number;
    })
  | (Pointer & { mode: "resize"; meeting: Meeting; start: number; targetEnd: number })
  | (Pointer & { mode: "create"; dayIndex: number; anchor: number; current: number });

function currentMinutes(): number {
  return minutesInto(new Date().toISOString());
}

function snapDown(minutes: number): number {
  return Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function snapNearest(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Wall-clock minutes under a pointer, measured against the hour ruler. */
function minutesAt(columns: HTMLElement | null, clientY: number): number {
  const top = columns?.getBoundingClientRect().top ?? 0;
  return clamp(((clientY - top) / HOUR_HEIGHT) * 60, 0, MINUTES_PER_DAY - SNAP_MINUTES);
}

/** The span a create gesture covers, whichever way it was dragged. */
function sweep(anchor: number, current: number): { from: number; to: number } {
  const from = Math.min(anchor, current);
  return { from, to: Math.min(Math.max(anchor, current) + SNAP_MINUTES, MINUTES_PER_DAY) };
}

/**
 * The day and week grid.
 *
 * Meetings are absolutely positioned against a 24-hour ruler and overlapping
 * ones share the column. With a mouse: click or drag across empty time to
 * schedule, drag a meeting to move it, drag its bottom edge to change its
 * length. The API takes local wall-clock, which is exactly what a drop is.
 */
export function TimeGrid({
  days,
  meetings,
  selectedId,
  onSelect,
  onMove,
  onResize,
  onCreate,
  onEdit,
  onPickDay,
}: {
  days: DayKey[];
  meetings: Meeting[];
  selectedId: string | null;
  onSelect: (meeting: Meeting, anchor: DOMRect) => void;
  onMove: (meeting: Meeting, day: DayKey, minutes: number) => void;
  onResize: (meeting: Meeting, duration: number) => void;
  /** `duration` is 0 for a plain click, leaving the length to the dialog. */
  onCreate: (day: DayKey, startMinutes: number, duration: number) => void;
  onEdit: (meeting: Meeting) => void;
  onPickDay: (day: DayKey) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  // A cross-day drag re-parents the block into another column, so the node
  // that started the gesture is unmounted mid-drag. The pointer listeners
  // therefore live on the window, and the live drag state in a ref.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Null until mounted: the server cannot know the viewer's clock, and a
  // guess would only be a hydration mismatch.
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  const today = todayKey();
  const todayIndex = days.indexOf(today);
  const moving = drag?.active && drag.mode === "move" ? drag : null;
  const resizing = drag?.active && drag.mode === "resize" ? drag : null;
  const creating = drag?.active && drag.mode === "create" ? drag : null;

  useEffect(() => {
    setNowMinutes(currentMinutes());
    const timer = setInterval(() => setNowMinutes(currentMinutes()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Open on the working day rather than at midnight.
    const element = scrollRef.current;
    if (element)
      element.scrollTop = (Math.max(currentMinutes() - 90, 7 * 60) / 60) * HOUR_HEIGHT - 12;
  }, []);

  const spanOf = useMemo(() => {
    return (meeting: Meeting) => {
      if (moving?.meeting.id === meeting.id) {
        return {
          start: moving.targetMinutes,
          end: Math.min(moving.targetMinutes + moving.duration, MINUTES_PER_DAY),
        };
      }
      const start = minutesInto(meeting.starts_at);
      if (resizing?.meeting.id === meeting.id) return { start, end: resizing.targetEnd };
      return { start, end: Math.min(start + durationMinutes(meeting), MINUTES_PER_DAY) };
    };
  }, [moving, resizing]);

  const columns = useMemo(() => {
    const index = new Map(days.map((day, position) => [day, position]));
    const buckets: Meeting[][] = days.map(() => []);
    for (const meeting of meetings) {
      const position =
        moving?.meeting.id === meeting.id ? moving.targetDayIndex : index.get(dayOf(meeting));
      if (position === undefined) continue;
      buckets[position].push(meeting);
    }
    return buckets.map((bucket) => placeDay(bucket, spanOf));
  }, [days, meetings, moving, spanOf]);

  function begin(next: Drag) {
    dragRef.current = next;
    setDrag(next);
  }

  function pointer(event: React.PointerEvent): Pointer | null {
    // Touch keeps the scroll gesture; pointer editing is a mouse action.
    if (event.pointerType !== "mouse" || event.button !== 0) return null;
    event.preventDefault();
    return {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      active: false,
    };
  }

  function beginMove(event: React.PointerEvent, meeting: Meeting, dayIndex: number) {
    const base = pointer(event);
    if (!base) return;
    begin({
      ...base,
      mode: "move",
      meeting,
      dayIndex,
      duration: Math.min(durationMinutes(meeting), MINUTES_PER_DAY),
      targetDayIndex: dayIndex,
      targetMinutes: minutesInto(meeting.starts_at),
    });
  }

  function beginResize(event: React.PointerEvent, meeting: Meeting) {
    event.stopPropagation();
    const base = pointer(event);
    if (!base) return;
    const start = minutesInto(meeting.starts_at);
    begin({
      ...base,
      mode: "resize",
      meeting,
      start,
      targetEnd: Math.min(start + durationMinutes(meeting), MINUTES_PER_DAY),
    });
  }

  function beginCreate(event: React.PointerEvent<HTMLDivElement>, dayIndex: number) {
    // Only empty time: a press on a meeting is that meeting's gesture.
    if (event.target !== event.currentTarget) return;
    const base = pointer(event);
    if (!base) return;
    const anchor = snapDown(minutesAt(columnsRef.current, event.clientY));
    begin({ ...base, mode: "create", dayIndex, anchor, current: anchor });
  }

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - current.originX;
      const deltaY = event.clientY - current.originY;
      if (
        !current.active &&
        Math.abs(deltaX) < DRAG_THRESHOLD &&
        Math.abs(deltaY) < DRAG_THRESHOLD
      ) {
        return;
      }

      let next: Drag;
      if (current.mode === "move") {
        const columnWidth =
          (columnsRef.current?.clientWidth ?? MIN_COLUMN_WIDTH) / days.length;
        const start = minutesInto(current.meeting.starts_at) + (deltaY / HOUR_HEIGHT) * 60;
        next = {
          ...current,
          active: true,
          targetDayIndex: clamp(
            current.dayIndex + Math.round(deltaX / columnWidth),
            0,
            days.length - 1,
          ),
          targetMinutes: clamp(snapNearest(start), 0, MINUTES_PER_DAY - current.duration),
        };
      } else if (current.mode === "resize") {
        const originalEnd = current.start + durationMinutes(current.meeting);
        next = {
          ...current,
          active: true,
          targetEnd: clamp(
            snapNearest(originalEnd + (deltaY / HOUR_HEIGHT) * 60),
            current.start + SNAP_MINUTES,
            MINUTES_PER_DAY,
          ),
        };
      } else {
        next = {
          ...current,
          active: true,
          current: snapDown(minutesAt(columnsRef.current, event.clientY)),
        };
      }
      dragRef.current = next;
      setDrag(next);
    };

    const finish = (commit: boolean) => (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDrag(null);

      if (current.mode === "create") {
        if (!commit) return;
        const day = days[current.dayIndex];
        if (!current.active) {
          onCreate(day, current.anchor, 0);
          return;
        }
        const { from, to } = sweep(current.anchor, current.current);
        onCreate(day, from, to - from);
        return;
      }

      if (!current.active) return;
      // The drop consumed the gesture; the click that follows it must not
      // also open the meeting. When the pointer was released somewhere else
      // there is no such click, so the flag is cleared on the next tick.
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      if (!commit) return;

      if (current.mode === "move") {
        const day = days[current.targetDayIndex];
        const moved =
          day !== dayOf(current.meeting) ||
          current.targetMinutes !== minutesInto(current.meeting.starts_at);
        if (moved) onMove(current.meeting, day, current.targetMinutes);
      } else {
        const duration = current.targetEnd - current.start;
        if (duration !== durationMinutes(current.meeting)) onResize(current.meeting, duration);
      }
    };

    const onPointerUp = finish(true);
    const onPointerCancel = finish(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [dragging, days, onMove, onResize, onCreate]);

  return (
    <div
      ref={scrollRef}
      className={cn(
        "bg-card relative max-h-[calc(100vh-15rem)] min-h-96 overflow-auto rounded-xl border",
        resizing && "cursor-ns-resize",
      )}
    >
      <div className="flex">
        <div
          className="bg-card sticky left-0 z-50 shrink-0"
          style={{ width: GUTTER_WIDTH }}
        >
          <div
            className="bg-card text-muted-foreground sticky top-0 z-10 flex items-end justify-end border-r border-b px-2 pb-1.5 text-[10px] font-medium tracking-wide uppercase"
            style={{ height: HEADER_HEIGHT }}
            title={`Times shown in ${days[0] ? zoneAbbreviation(days[0]) : ""}`}
          >
            {days[0] ? zoneAbbreviation(days[0]) : ""}
          </div>
          <div className="relative border-r" style={{ height: 24 * HOUR_HEIGHT }}>
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {minutesLabel(hour * 60)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1" style={{ minWidth: days.length * MIN_COLUMN_WIDTH }}>
          <div
            className="bg-card sticky top-0 z-40 grid border-b"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
              height: HEADER_HEIGHT,
            }}
          >
            {days.map((day) => {
              const isToday = day === today;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="hover:bg-muted flex flex-col items-center justify-center gap-0.5 transition-colors"
                >
                  <span
                    className={cn(
                      "text-[11px] font-medium tracking-wide uppercase",
                      isToday ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {dayLabel(day, days.length === 1 ? "EEEE" : "EEE")}
                  </span>
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-base",
                      isToday && "bg-primary text-primary-foreground font-medium",
                    )}
                  >
                    {dayLabel(day, "d")}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            ref={columnsRef}
            className="relative grid"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
              height: 24 * HOUR_HEIGHT,
            }}
          >
            {days.map((day, dayIndex) => (
              <div
                key={day}
                onPointerDown={(event) => beginCreate(event, dayIndex)}
                className="relative border-r last:border-r-0"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_HEIGHT}px`,
                }}
              >
                {columns[dayIndex].map((placement) => {
                  const { meeting } = placement;
                  const active =
                    moving?.meeting.id === meeting.id || resizing?.meeting.id === meeting.id;
                  const color = eventColor(meeting.meeting_type);
                  const cancelled = meeting.status === "cancelled";
                  const height = Math.max(
                    ((placement.endMinutes - placement.startMinutes) / 60) * HOUR_HEIGHT,
                    18,
                  );
                  const width = 100 / placement.columns;
                  const compact = height < 36;
                  const end =
                    resizing?.meeting.id === meeting.id
                      ? resizing.targetEnd
                      : placement.startMinutes + durationMinutes(meeting);
                  const who =
                    meeting.company_name && !meeting.title.includes(meeting.company_name)
                      ? meeting.company_name
                      : meeting.stage_name && !meeting.title.includes(meeting.stage_name)
                        ? meeting.stage_name
                        : null;

                  return (
                    <button
                      key={meeting.id}
                      type="button"
                      title={[meeting.title, meeting.company_name].filter(Boolean).join(" · ")}
                      onPointerDown={(event) => beginMove(event, meeting, dayIndex)}
                      onClick={(event) => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        onSelect(meeting, event.currentTarget.getBoundingClientRect());
                      }}
                      onDoubleClick={() => onEdit(meeting)}
                      className={cn(
                        "absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-shadow select-none",
                        active ? "cursor-grabbing shadow-lg" : "cursor-pointer hover:shadow-md",
                        cancelled && "line-through",
                      )}
                      style={{
                        top: (placement.startMinutes / 60) * HOUR_HEIGHT,
                        height,
                        left: `calc(${placement.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        zIndex: active ? 30 : selectedId === meeting.id ? 20 : 10,
                        backgroundColor: cancelled ? "var(--card)" : color.fill,
                        borderColor: cancelled ? color.fill : "transparent",
                        color: cancelled ? color.ink : color.foreground,
                        outline:
                          selectedId === meeting.id ? `2px solid ${color.ink}` : undefined,
                        outlineOffset: 1,
                      }}
                    >
                      {compact ? (
                        <span className="flex gap-1 truncate">
                          <span className="font-medium">
                            {minutesLabel(placement.startMinutes)}
                          </span>
                          <span className="truncate">{meeting.title}</span>
                        </span>
                      ) : (
                        <>
                          <span className="block truncate font-medium">{meeting.title}</span>
                          <span className="block truncate opacity-80">
                            {minutesLabel(placement.startMinutes)} – {minutesLabel(end)}
                          </span>
                          {who && height >= 52 && (
                            <span className="block truncate opacity-80">{who}</span>
                          )}
                        </>
                      )}
                      {!cancelled && (
                        <span
                          aria-hidden
                          onPointerDown={(event) => beginResize(event, meeting)}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        />
                      )}
                    </button>
                  );
                })}

                {creating?.dayIndex === dayIndex && (
                  <CreatePreview anchor={creating.anchor} current={creating.current} />
                )}
              </div>
            ))}

            {nowMinutes !== null && todayIndex >= 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-[25]"
                style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
              >
                <div className="h-px w-full" style={{ backgroundColor: NOW_LINE }} />
                <div
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    backgroundColor: NOW_LINE,
                    left: `${(todayIndex / days.length) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatePreview({ anchor, current }: { anchor: number; current: number }) {
  const { from, to } = sweep(anchor, current);
  return (
    <div
      aria-hidden
      className="border-primary bg-primary/10 text-primary pointer-events-none absolute inset-x-0.5 z-30 rounded-md border-2 border-dashed px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
      style={{ top: (from / 60) * HOUR_HEIGHT, height: ((to - from) / 60) * HOUR_HEIGHT }}
    >
      New · {minutesLabel(from)} – {minutesLabel(to)}
    </div>
  );
}
