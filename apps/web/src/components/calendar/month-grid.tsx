"use client";

import { useMemo } from "react";

import {
  dayLabel,
  dayOf,
  eventColor,
  isSameMonth,
  minutesInto,
  minutesLabel,
  todayKey,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VISIBLE_PER_DAY = 3;

export function MonthGrid({
  anchor,
  days,
  meetings,
  selectedId,
  onSelect,
  onPickDay,
}: {
  anchor: DayKey;
  days: DayKey[];
  meetings: Meeting[];
  selectedId: string | null;
  onSelect: (meeting: Meeting, element: DOMRect) => void;
  onPickDay: (day: DayKey) => void;
}) {
  const today = todayKey();

  const byDay = useMemo(() => {
    const map = new Map<DayKey, Meeting[]>();
    for (const meeting of [...meetings].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
      const key = dayOf(meeting);
      map.set(key, [...(map.get(key) ?? []), meeting]);
    }
    return map;
  }, [meetings]);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="grid grid-cols-7 border-b border-[var(--color-line)]">
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="py-2 text-center text-[11px] font-medium tracking-wide text-[var(--color-ink-soft)] uppercase"
          >
            {weekday}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-[var(--color-line)]">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const hidden = items.length - VISIBLE_PER_DAY;
          const isToday = day === today;
          const outside = !isSameMonth(day, anchor);

          return (
            <div
              key={day}
              className={`flex min-h-28 flex-col gap-0.5 p-1 ${
                outside ? "bg-[var(--color-canvas)]" : "bg-[var(--color-surface)]"
              }`}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                className={`mx-auto flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs whitespace-nowrap transition-colors ${
                  isToday
                    ? "bg-[var(--color-brand)] font-medium text-white"
                    : `hover:bg-[var(--color-canvas)] ${outside ? "text-[var(--color-ink-soft)]" : ""}`
                }`}
              >
                {dayLabel(day, day.endsWith("-01") ? "d MMM" : "d")}
              </button>

              {items.slice(0, VISIBLE_PER_DAY).map((meeting) => {
                const color = eventColor(meeting.meeting_type);
                const cancelled = meeting.status === "cancelled";
                return (
                  <button
                    key={meeting.id}
                    type="button"
                    onClick={(event) => onSelect(meeting, event.currentTarget.getBoundingClientRect())}
                    className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-[var(--color-brand-soft)] ${
                      cancelled ? "line-through opacity-60" : ""
                    } ${selectedId === meeting.id ? "bg-[var(--color-brand-soft)]" : ""}`}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color.fill }}
                    />
                    <span className="shrink-0 tabular-nums text-[var(--color-ink-soft)]">
                      {minutesLabel(minutesInto(meeting.starts_at))}
                    </span>
                    <span className="truncate">{meeting.title}</span>
                  </button>
                );
              })}

              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="px-1 text-left text-[11px] font-medium text-[var(--color-ink-soft)] hover:underline"
                >
                  {hidden} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
