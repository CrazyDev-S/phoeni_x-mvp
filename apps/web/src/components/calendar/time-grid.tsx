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

const HOUR_HEIGHT = 48;
const HEADER_HEIGHT = 56;
const SNAP_MINUTES = 15;
const MIN_COLUMN_WIDTH = 110;
const GUTTER_WIDTH = 56;
const HOURS = Array.from({ length: 23 }, (_, index) => index + 1);
const NOW_RED = "#d93025";

interface Drag {
  meeting: Meeting;
  pointerId: number;
  originX: number;
  originY: number;
  dayIndex: number;
  duration: number;
  targetDayIndex: number;
  targetMinutes: number;
  active: boolean;
}

function currentMinutes(): number {
  const now = new Date();
  return minutesInto(now.toISOString());
}

/**
 * The day and week grid.
 *
 * Meetings are absolutely positioned against a 24-hour ruler, overlapping ones
 * share the column, and a mouse drag reschedules — the API takes local
 * wall-clock, which is exactly what a drop position is.
 */
export function TimeGrid({
  days,
  meetings,
  selectedId,
  onSelect,
  onMove,
  onPickDay,
}: {
  days: DayKey[];
  meetings: Meeting[];
  selectedId: string | null;
  onSelect: (meeting: Meeting, anchor: DOMRect) => void;
  onMove: (meeting: Meeting, day: DayKey, minutes: number) => void;
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
  const preview = drag?.active ? drag : null;

  useEffect(() => {
    setNowMinutes(currentMinutes());
    const timer = setInterval(() => setNowMinutes(currentMinutes()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Open on the working day rather than at midnight.
    const element = scrollRef.current;
    if (element) element.scrollTop = (Math.max(currentMinutes() - 90, 7 * 60) / 60) * HOUR_HEIGHT - 12;
  }, []);

  const spanOf = useMemo(() => {
    return (meeting: Meeting) => {
      const start =
        preview?.meeting.id === meeting.id ? preview.targetMinutes : minutesInto(meeting.starts_at);
      return { start, end: Math.min(start + durationMinutes(meeting), MINUTES_PER_DAY) };
    };
  }, [preview]);

  const columns = useMemo(() => {
    const index = new Map(days.map((day, position) => [day, position]));
    const buckets: Meeting[][] = days.map(() => []);
    for (const meeting of meetings) {
      const position =
        preview?.meeting.id === meeting.id ? preview.targetDayIndex : index.get(dayOf(meeting));
      if (position === undefined) continue;
      buckets[position].push(meeting);
    }
    return buckets.map((bucket) => placeDay(bucket, spanOf));
  }, [days, meetings, preview, spanOf]);

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, meeting: Meeting, dayIndex: number) {
    // Touch keeps the scroll gesture; dragging a meeting is a mouse action.
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    event.preventDefault();
    const next: Drag = {
      meeting,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      dayIndex,
      duration: Math.min(durationMinutes(meeting), MINUTES_PER_DAY),
      targetDayIndex: dayIndex,
      targetMinutes: minutesInto(meeting.starts_at),
      active: false,
    };
    dragRef.current = next;
    setDrag(next);
  }

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - current.originX;
      const deltaY = event.clientY - current.originY;
      if (!current.active && Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;

      const columnWidth = (columnsRef.current?.clientWidth ?? MIN_COLUMN_WIDTH) / days.length;
      const start = minutesInto(current.meeting.starts_at) + (deltaY / HOUR_HEIGHT) * 60;
      const next: Drag = {
        ...current,
        active: true,
        targetDayIndex: clamp(current.dayIndex + Math.round(deltaX / columnWidth), 0, days.length - 1),
        targetMinutes: clamp(
          Math.round(start / SNAP_MINUTES) * SNAP_MINUTES,
          0,
          MINUTES_PER_DAY - current.duration,
        ),
      };
      dragRef.current = next;
      setDrag(next);
    };

    const finish = (commit: boolean) => (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      if (!current.active) return;

      // The drop consumed the gesture; the click that follows it must not
      // also open the meeting.
      suppressClick.current = true;
      const day = days[current.targetDayIndex];
      const moved =
        day !== dayOf(current.meeting) ||
        current.targetMinutes !== minutesInto(current.meeting.starts_at);
      if (commit && moved) onMove(current.meeting, day, current.targetMinutes);
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
  }, [dragging, days, onMove]);

  return (
    <div
      ref={scrollRef}
      className="relative max-h-[calc(100vh-15rem)] min-h-96 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]"
    >
      <div className="flex">
        <div className="sticky left-0 z-50 shrink-0 bg-[var(--color-surface)]" style={{ width: GUTTER_WIDTH }}>
          <div
            className="sticky top-0 z-10 flex items-end justify-end border-b border-r border-[var(--color-line)] bg-[var(--color-surface)] px-2 pb-1.5 text-[10px] font-medium tracking-wide text-[var(--color-ink-soft)] uppercase"
            style={{ height: HEADER_HEIGHT }}
            title={`Times shown in ${days[0] ? zoneAbbreviation(days[0]) : ""}`}
          >
            {days[0] ? zoneAbbreviation(days[0]) : ""}
          </div>
          <div className="relative border-r border-[var(--color-line)]" style={{ height: 24 * HOUR_HEIGHT }}>
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-[var(--color-ink-soft)]"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {minutesLabel(hour * 60)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1" style={{ minWidth: days.length * MIN_COLUMN_WIDTH }}>
          <div
            className="sticky top-0 z-40 grid border-b border-[var(--color-line)] bg-[var(--color-surface)]"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, height: HEADER_HEIGHT }}
          >
            {days.map((day) => {
              const isToday = day === today;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="flex flex-col items-center justify-center gap-0.5 transition-colors hover:bg-[var(--color-canvas)]"
                >
                  <span
                    className={`text-[11px] font-medium tracking-wide uppercase ${
                      isToday ? "text-[var(--color-brand)]" : "text-[var(--color-ink-soft)]"
                    }`}
                  >
                    {dayLabel(day, days.length === 1 ? "EEEE" : "EEE")}
                  </span>
                  <span
                    className={`flex size-7 items-center justify-center rounded-full text-base ${
                      isToday ? "bg-[var(--color-brand)] font-medium text-white" : ""
                    }`}
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
                className="relative border-r border-[var(--color-line)] last:border-r-0"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_HEIGHT}px`,
                }}
              >
                {columns[dayIndex].map((placement) => {
                  const { meeting } = placement;
                  const dragging = preview?.meeting.id === meeting.id;
                  const color = eventColor(meeting.meeting_type);
                  const cancelled = meeting.status === "cancelled";
                  const height = Math.max(
                    ((placement.endMinutes - placement.startMinutes) / 60) * HOUR_HEIGHT,
                    18,
                  );
                  const width = 100 / placement.columns;
                  const compact = height < 36;

                  return (
                    <button
                      key={meeting.id}
                      type="button"
                      onPointerDown={(event) => beginDrag(event, meeting, dayIndex)}
                      onClick={(event) => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        onSelect(meeting, event.currentTarget.getBoundingClientRect());
                      }}
                      className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-shadow select-none ${
                        dragging ? "cursor-grabbing shadow-lg" : "cursor-pointer hover:shadow-md"
                      } ${cancelled ? "line-through" : ""}`}
                      style={{
                        top: (placement.startMinutes / 60) * HOUR_HEIGHT,
                        height,
                        left: `calc(${placement.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        zIndex: dragging ? 30 : selectedId === meeting.id ? 20 : 10,
                        backgroundColor: cancelled ? "var(--color-surface)" : color.fill,
                        borderColor: cancelled ? color.fill : "transparent",
                        color: cancelled ? color.ink : "#ffffff",
                        outline: selectedId === meeting.id ? `2px solid ${color.ink}` : undefined,
                        outlineOffset: 1,
                      }}
                    >
                      {compact ? (
                        <span className="flex gap-1 truncate">
                          <span className="font-medium">{minutesLabel(placement.startMinutes)}</span>
                          <span className="truncate">{meeting.title}</span>
                        </span>
                      ) : (
                        <>
                          <span className="block truncate font-medium">{meeting.title}</span>
                          <span className="block truncate opacity-80">
                            {minutesLabel(placement.startMinutes)} –{" "}
                            {minutesLabel(placement.startMinutes + durationMinutes(meeting))}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {nowMinutes !== null && todayIndex >= 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-[25]"
                style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
              >
                <div className="h-px w-full" style={{ backgroundColor: NOW_RED }} />
                <div
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    backgroundColor: NOW_RED,
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
