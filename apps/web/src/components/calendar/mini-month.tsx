"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { IconButton } from "./toolbar";
import {
  addMonths,
  dayLabel,
  isSameMonth,
  monthGrid,
  todayKey,
  type DayKey,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

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
    <div className="bg-card rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">{dayLabel(month, "MMMM yyyy")}</p>
        <div className="flex">
          <IconButton label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
            <ChevronRight />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS.map((weekday, index) => (
          <span key={index} className="text-muted-foreground py-1 text-[10px] font-medium">
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
              className={cn(
                "relative mx-auto flex size-7 items-center justify-center rounded-full text-xs transition-colors",
                isToday
                  ? "bg-primary text-primary-foreground font-medium"
                  : inRange
                    ? "bg-muted text-foreground font-medium"
                    : isSameMonth(day, month)
                      ? "hover:bg-muted"
                      : "text-muted-foreground/60 hover:bg-muted",
              )}
            >
              {dayLabel(day, "d")}
              {busyDays.has(day) && !isToday && (
                <span className="bg-foreground/50 absolute bottom-0.5 size-1 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
