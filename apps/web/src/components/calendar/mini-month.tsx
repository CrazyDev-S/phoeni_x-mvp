"use client";

import { Chevron, IconButton } from "./toolbar";
import {
  addMonths,
  dayLabel,
  isSameMonth,
  monthGrid,
  todayKey,
  type DayKey,
} from "@/lib/calendar";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** The sidebar navigator: jump anywhere without paging the main grid. */
export function MiniMonth({
  month,
  selected,
  highlighted,
  busyDays,
  onMonth,
  onPick,
}: {
  month: DayKey;
  selected: DayKey;
  highlighted: Set<DayKey>;
  busyDays: Set<DayKey>;
  onMonth: (month: DayKey) => void;
  onPick: (day: DayKey) => void;
}) {
  const days = monthGrid(month);
  const today = todayKey();

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">{dayLabel(month, "MMMM yyyy")}</p>
        <div className="flex">
          <IconButton label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
            <Chevron direction="left" />
          </IconButton>
          <IconButton label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
            <Chevron direction="right" />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS.map((weekday, index) => (
          <span key={index} className="py-1 text-[10px] font-medium text-[var(--color-ink-soft)]">
            {weekday}
          </span>
        ))}
        {days.map((day) => {
          const isToday = day === today;
          const inRange = highlighted.has(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              aria-current={day === selected ? "date" : undefined}
              className={`relative mx-auto flex size-7 items-center justify-center rounded-full text-xs transition-colors ${
                isToday
                  ? "bg-[var(--color-brand)] font-medium text-white"
                  : inRange
                    ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                    : isSameMonth(day, month)
                      ? "hover:bg-[var(--color-canvas)]"
                      : "text-[var(--color-ink-soft)] opacity-60 hover:bg-[var(--color-canvas)]"
              }`}
            >
              {dayLabel(day, "d")}
              {busyDays.has(day) && !isToday && (
                <span className="absolute bottom-0.5 size-1 rounded-full bg-[var(--color-brand)]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
