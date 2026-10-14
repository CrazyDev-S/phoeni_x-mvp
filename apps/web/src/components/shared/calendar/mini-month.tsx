"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "./toolbar";
import { Card } from "@/components/ui/card";
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

/**
 * The sidebar navigator: jump anywhere without paging the main grid. A week
 * that is on screen reads as one pale pill; `children` sit under a divider.
 */
export function MiniMonth({
  month,
  selected,
  highlighted,
  busyDays,
  onMonth,
  onPick,
  children,
}: {
  month: DayKey;
  selected: DayKey;
  highlighted: Set<DayKey>;
  busyDays: Set<DayKey>;
  onMonth: (month: DayKey) => void;
  onPick: (day: DayKey) => void;
  children?: ReactNode;
}) {
  const days = monthGrid(month);
  const today = todayKey();
  const weeks = Array.from({ length: days.length / 7 }, (_, row) => days.slice(row * 7, row * 7 + 7));

  return (
    <Card className="gap-0 px-5 pt-[22px] pb-[18px]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[1.0625rem] font-semibold">{dayLabel(month, "MMMM yyyy")}</p>
        <div className="flex gap-1.5">
          <IconButton label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
            <ChevronRight />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((weekday, index) => (
          <span key={index} className="text-subtle py-2 text-[11px] font-bold">
            {weekday}
          </span>
        ))}
      </div>
      {weeks.map((week) => {
        const wholeWeek = week.every((day) => highlighted.has(day));
        return (
          <div
            key={week[0]}
            className={cn(
              "-mx-1.5 grid grid-cols-7 rounded-full px-1.5 text-center",
              wholeWeek && "bg-brand-soft",
            )}
          >
            {week.map((day) => {
              const isToday = day === today;
              const inMonth = isSameMonth(day, month);
              const picked = !wholeWeek && highlighted.has(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPick(day)}
                  aria-current={day === selected ? "date" : undefined}
                  className={cn(
                    "relative mx-auto grid h-9 w-full place-items-center rounded-full text-[0.84rem] outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    inMonth ? "font-semibold" : "text-subtle/80 font-medium",
                  )}
                >
                  {(isToday || picked) && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-0.5 left-1/2 size-8 -translate-x-1/2 rounded-full",
                        isToday ? "bg-primary" : "bg-brand-soft",
                      )}
                    />
                  )}
                  <span className={cn("relative", isToday && "text-primary-foreground")}>
                    {dayLabel(day, "d")}
                  </span>
                  {busyDays.has(day) && !isToday && (
                    <span className="bg-subtle absolute bottom-[3px] left-1/2 size-1 -translate-x-1/2 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        );
      })}

      {children && <div className="border-border mt-3.5 border-t pt-3.5">{children}</div>}
    </Card>
  );
}
