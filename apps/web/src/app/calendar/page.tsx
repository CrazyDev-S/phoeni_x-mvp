"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CalendarDays, Globe, Keyboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EventPopover } from "@/components/calendar/event-popover";
import { MiniMonth } from "@/components/calendar/mini-month";
import { MonthGrid } from "@/components/calendar/month-grid";
import { TimeGrid } from "@/components/calendar/time-grid";
import { rangeTitle, Toolbar, type CalendarView } from "@/components/calendar/toolbar";
import { NextCallBanner } from "@/components/next-call";
import { PageHero } from "@/components/page-hero";
import { SidePanel } from "@/components/side-panel";
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
    () =>
      view === "day" ? [anchor] : view === "week" ? weekOf(anchor) : monthGrid(anchor),
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
      request<Meeting>(`/api/v1/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onMutate: ({ id, optimistic }: PatchVariables) => {
      if (!optimistic) return;
      queryClient.setQueriesData<Meeting[]>({ queryKey: ["meetings"] }, (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, ...optimistic } : row)),
      );
    },
    onSuccess: (updated) => {
      setSelected((current) =>
        current && current.meeting.id === updated.id
          ? { ...current, meeting: updated }
          : current,
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
    <div className="space-y-8">
      <PageHero
        eyebrow="Schedule"
        eyebrowIcon={CalendarDays}
        title="Calendar"
        description="Interview stages and recurring team meetings, every time shown in your display zone."
      />

      <NextCallBanner />

      <Toolbar
        view={view}
        title={rangeTitle(view, anchor, days)}
        busy={isFetching}
        onView={setView}
        onToday={() => setAnchor(todayKey())}
        onStep={step}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="min-w-0">
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

        <aside className="hidden space-y-6 lg:sticky lg:top-24 lg:block">
          <MiniMonth
            month={miniMonth}
            selected={anchor}
            highlighted={highlighted}
            busyDays={busyDays}
            onMonth={setMiniMonth}
            onPick={(day) => setAnchor(day)}
          />

          <SidePanel icon={Keyboard} title="Getting around">
            <ul className="space-y-3 text-sm">
              {[
                [<Kbd key="t">T</Kbd>, "Jump to today"],
                [
                  <span key="dwm" className="flex gap-1">
                    <Kbd>D</Kbd>
                    <Kbd>W</Kbd>
                    <Kbd>M</Kbd>
                  </span>,
                  "Day, week or month",
                ],
                [
                  <span key="arrows" className="flex gap-1">
                    <Kbd>←</Kbd>
                    <Kbd>→</Kbd>
                  </span>,
                  "Page back and forward",
                ],
              ].map(([keys, label], index) => (
                <li key={index} className="flex items-center gap-3">
                  <span className="shrink-0">{keys}</span>
                  <span className="text-muted-foreground text-xs">{label}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-4 border-t pt-3 text-xs leading-relaxed">
              Drag a meeting to reschedule it — the API takes local wall-clock, which is
              exactly what a drop position is.
            </p>
          </SidePanel>

          <SidePanel icon={Globe} title="Times and zones">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Everything is rendered in US Eastern ({DISPLAY_TIME_ZONE}). The zone is
              derived from the instant, so it reads EST in winter and EDT in summer.
            </p>
            {!isFetching && !meetings.length && (
              <p className="text-muted-foreground mt-3 border-t pt-3 text-xs leading-relaxed">
                Nothing scheduled in this range. Meetings appear once you schedule an
                interview stage or create a recurring team meeting.
              </p>
            )}
          </SidePanel>
        </aside>
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

/** A key cap, for the shortcut legend in the aside. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 text-[11px] font-medium">
      {children}
    </kbd>
  );
}
