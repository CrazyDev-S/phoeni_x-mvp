"use client";

import { Plus } from "lucide-react";
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
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="text-muted-foreground py-2 text-center text-[11px] font-medium tracking-wide uppercase"
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
                "group relative flex min-h-28 flex-col gap-0.5 p-1",
                outside ? "bg-muted/40" : "bg-card",
              )}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                className={cn(
                  "mx-auto flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs whitespace-nowrap transition-colors",
                  isToday
                    ? "bg-primary text-primary-foreground font-medium"
                    : cn("hover:bg-muted", outside && "text-muted-foreground"),
                )}
              >
                {dayLabel(day, day.endsWith("-01") ? "d MMM" : "d")}
              </button>
              <button
                type="button"
                aria-label={`Schedule on ${dayLabel(day, "EEEE d MMMM")}`}
                onClick={() => onCreate(day)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1 right-1 flex size-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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
                      "hover:bg-muted flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] transition-colors",
                      cancelled && "line-through opacity-60",
                      selectedId === meeting.id && "bg-muted",
                    )}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color.fill }}
                    />
                    <span className="text-muted-foreground shrink-0 tabular-nums">
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
                  className="text-muted-foreground px-1 text-left text-[11px] font-medium hover:underline"
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
