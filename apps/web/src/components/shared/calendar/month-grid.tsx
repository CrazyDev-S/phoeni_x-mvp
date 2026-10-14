"use client";

import { Plus } from "lucide-react";
import { useMemo } from "react";

import {
  dayLabel,
  dayOf,
  clockShort,
  eventColor,
  isSameMonth,
  minutesInto,
  todayKey,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VISIBLE_PER_DAY = 3;

export function MonthGrid({
  anchor,
  days,
  meetings,
  selectedId,
  onSelect,
  onEdit,
  onCreate,
  onPickDay,
}: {
  anchor: DayKey;
  days: DayKey[];
  meetings: Meeting[];
  selectedId: string | null;
  onSelect: (meeting: Meeting, element: DOMRect) => void;
  onEdit: (meeting: Meeting) => void;
  onCreate: (day: DayKey) => void;
  onPickDay: (day: DayKey) => void;
}) {
  const today = todayKey();

  const byDay = useMemo(() => {
    const map = new Map<DayKey, Meeting[]>();
    for (const meeting of [...meetings].sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at),
    )) {
      const key = dayOf(meeting);
      map.set(key, [...(map.get(key) ?? []), meeting]);
    }
    return map;
  }, [meetings]);

  return (
    <div className="bg-card shadow-card overflow-hidden rounded-[2rem]">
      <div className="border-border grid grid-cols-7 border-b">
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="text-muted-foreground py-4 text-center text-[11.5px] font-bold tracking-widest uppercase"
          >
            {weekday}
          </span>
        ))}
      </div>

      <div className="bg-border grid grid-cols-7 gap-px">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const hidden = items.length - VISIBLE_PER_DAY;
          const isToday = day === today;
          const outside = !isSameMonth(day, anchor);

          return (
            <div
              key={day}
              className={cn(
                "group relative flex min-h-32 flex-col gap-1 p-1.5",
                outside ? "bg-soft" : isToday ? "bg-brand-soft/55" : "bg-card",
              )}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                className={cn(
                  "mx-auto flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[0.8125rem] font-semibold whitespace-nowrap transition-colors",
                  isToday
                    ? "bg-brand text-brand-foreground"
                    : cn("hover:bg-soft-2", outside && "text-subtle"),
                )}
              >
                {dayLabel(day, day.endsWith("-01") ? "d MMM" : "d")}
              </button>
              <button
                type="button"
                aria-label={`Schedule on ${dayLabel(day, "EEEE d MMMM")}`}
                onClick={() => onCreate(day)}
                className="text-muted-foreground hover:bg-soft-2 hover:text-foreground absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Plus className="size-3.5" />
              </button>

              {items.slice(0, VISIBLE_PER_DAY).map((meeting) => {
                const color = eventColor(meeting.meeting_type);
                const cancelled = meeting.status === "cancelled";
                return (
                  <button
                    key={meeting.id}
                    type="button"
                    title={[meeting.title, meeting.company_name].filter(Boolean).join(" · ")}
                    onClick={(event) =>
                      onSelect(meeting, event.currentTarget.getBoundingClientRect())
                    }
                    onDoubleClick={() => onEdit(meeting)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-left text-[11.5px] font-bold transition-shadow hover:shadow-md",
                      cancelled &&
                        "border-foreground/20 text-muted-foreground border-[1.5px] border-dashed line-through",
                    )}
                    style={{
                      backgroundColor: cancelled ? "var(--card)" : color.fill,
                      color: cancelled ? undefined : color.foreground,
                      outline:
                        selectedId === meeting.id ? "2px solid var(--foreground)" : undefined,
                      outlineOffset: 1,
                    }}
                  >
                    <span className="shrink-0 tabular-nums">
                      {clockShort(minutesInto(meeting.starts_at))}
                    </span>
                    <span className="truncate">{meeting.title}</span>
                  </button>
                );
              })}

              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="text-muted-foreground px-1 text-left text-[11.5px] font-semibold hover:underline"
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
