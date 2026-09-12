"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EventPopover } from "@/components/calendar/event-popover";
import { MiniMonth } from "@/components/calendar/mini-month";
import { MonthGrid } from "@/components/calendar/month-grid";
import { TimeGrid } from "@/components/calendar/time-grid";
import { rangeTitle, Toolbar, type CalendarView } from "@/components/calendar/toolbar";
import { NextCallBanner } from "@/components/next-call";
import { request } from "@/lib/api";
import {
  addDays,
  addMonths,
  dayOf,
  durationMinutes,
  instantAt,
  minutesLabel,
  monthGrid,
  todayKey,
  weekOf,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";
import { DISPLAY_TIME_ZONE } from "@/lib/format";

interface Selection {
  meeting: Meeting;
  anchor: DOMRect;
}

interface PatchVariables {
  id: string;
  body: Record<string, unknown>;
  /** Applied to the cache up front, so a dragged meeting lands where it was dropped. */
  optimistic?: Pick<Meeting, "starts_at" | "ends_at">;
}

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<DayKey>(() => todayKey());
  const [miniMonth, setMiniMonth] = useState<DayKey>(anchor);
  const [selected, setSelected] = useState<Selection | null>(null);

  const days = useMemo(
    () => (view === "day" ? [anchor] : view === "week" ? weekOf(anchor) : monthGrid(anchor)),
    [view, anchor],
  );
  const from = days[0];
  const to = days[days.length - 1];

  const { data, isFetching } = useQuery({
    queryKey: ["meetings", from, to],
    queryFn: () => request<Meeting[]>(`/api/v1/meetings?from=${from}&to=${to}`),
    // Keep the previous grid on screen while the next range loads, so paging
    // does not blink through an empty week.
    placeholderData: keepPreviousData,
  });
  const meetings = useMemo(() => data ?? [], [data]);

  const patch = useMutation({
    mutationFn: ({ id, body }: PatchVariables) =>
      request<Meeting>(`/api/v1/meetings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onMutate: ({ id, optimistic }: PatchVariables) => {
      if (!optimistic) return;
      queryClient.setQueriesData<Meeting[]>({ queryKey: ["meetings"] }, (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, ...optimistic } : row)),
      );
    },
    onSuccess: (updated) => {
      setSelected((current) =>
        current && current.meeting.id === updated.id ? { ...current, meeting: updated } : current,
      );
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["next-call"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  const step = useCallback(
    (direction: -1 | 1) => {
      setAnchor((current) =>
        view === "day"
          ? addDays(current, direction)
          : view === "week"
            ? addDays(current, 7 * direction)
            : addMonths(current, direction),
      );
    },
    [view],
  );

  const openDay = useCallback((day: DayKey) => {
    setAnchor(day);
    setView("day");
    setSelected(null);
  }, []);

  const move = useCallback(
    (meeting: Meeting, day: DayKey, minutes: number) => {
      const startsAt = instantAt(day, minutes);
      const endsAt = new Date(
        new Date(startsAt).getTime() + durationMinutes(meeting) * 60_000,
      ).toISOString();
      patch.mutate({
        id: meeting.id,
        body: { local_date: day, local_time: minutesLabel(minutes) },
        optimistic: { starts_at: startsAt, ends_at: endsAt },
      });
    },
    [patch],
  );

  // The mini calendar follows whatever the main grid is showing.
  useEffect(() => setMiniMonth(anchor), [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      switch (event.key.toLowerCase()) {
        case "t":
          setAnchor(todayKey());
          break;
        case "d":
          setView("day");
          break;
        case "w":
          setView("week");
          break;
        case "m":
          setView("month");
          break;
        case "arrowleft":
        case "k":
          step(-1);
          break;
        case "arrowright":
        case "j":
          step(1);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const highlighted = useMemo(
    () => new Set<DayKey>(view === "month" ? [] : days),
    [view, days],
  );
  const busyDays = useMemo(() => new Set(meetings.map(dayOf)), [meetings]);

  return (
    <div className="space-y-4">
      <NextCallBanner />

      <Toolbar
        view={view}
        title={rangeTitle(view, anchor, days)}
        busy={isFetching}
        onView={setView}
        onToday={() => setAnchor(todayKey())}
        onStep={step}
      />

      <div className="flex gap-4">
        <aside className="hidden w-56 shrink-0 space-y-3 lg:block">
          <MiniMonth
            month={miniMonth}
            selected={anchor}
            highlighted={highlighted}
            busyDays={busyDays}
            onMonth={setMiniMonth}
            onPick={(day) => setAnchor(day)}
          />
          <p className="px-1 text-xs leading-relaxed text-[var(--color-ink-soft)]">
            All times in US Eastern ({DISPLAY_TIME_ZONE}) — the zone is derived from the instant,
            so it reads EST in winter and EDT in summer.
          </p>
          {!isFetching && !meetings.length && (
            <p className="px-1 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              Nothing scheduled here. Meetings appear once you schedule an interview stage or
              create a recurring team meeting.
            </p>
          )}
          <p className="px-1 text-xs leading-relaxed text-[var(--color-ink-soft)]">
            Drag a meeting to reschedule it. Keys: <strong>T</strong> today, <strong>D</strong>/
            <strong>W</strong>/<strong>M</strong> views, <strong>←</strong>/<strong>→</strong> to
            page.
          </p>
        </aside>

        <div className="min-w-0 flex-1">
          {view === "month" ? (
            <MonthGrid
              anchor={anchor}
              days={days}
              meetings={meetings}
              selectedId={selected?.meeting.id ?? null}
              onSelect={(meeting, rect) => setSelected({ meeting, anchor: rect })}
              onPickDay={openDay}
            />
          ) : (
            <TimeGrid
              days={days}
              meetings={meetings}
              selectedId={selected?.meeting.id ?? null}
              onSelect={(meeting, rect) => setSelected({ meeting, anchor: rect })}
              onMove={move}
              onPickDay={openDay}
            />
          )}
        </div>
      </div>

      {selected && (
        <EventPopover
          meeting={selected.meeting}
          anchor={selected.anchor}
          pending={patch.isPending}
          onPatch={(body) => patch.mutate({ id: selected.meeting.id, body })}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
