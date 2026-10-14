"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CalendarClock, CalendarPlus, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CLOSED_STATUSES,
  currentStage,
  type ApplicationRow,
} from "@/components/remote/applications/shared";
import { EventPopover } from "@/components/shared/calendar/event-popover";
import { MeetingDialog, type MeetingDialogState } from "@/components/shared/calendar/meeting-dialog";
import { MiniMonth } from "@/components/shared/calendar/mini-month";
import { MonthGrid } from "@/components/shared/calendar/month-grid";
import { TimeGrid } from "@/components/shared/calendar/time-grid";
import { rangeTitle, Toolbar, type CalendarView } from "@/components/shared/calendar/toolbar";
import { NextCallBanner } from "@/components/shared/next-call";
import { PageHero } from "@/components/page-hero";
import { Tile } from "@/components/tile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { request } from "@/lib/api";
import {
  addDays,
  addMonths,
  dayOf,
  durationMinutes,
  eventColor,
  instantAt,
  minutesLabel,
  monthGrid,
  todayKey,
  weekOf,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";
import { formatDateTime, relative } from "@/lib/format";
import type { PortalId } from "@/lib/portals";
import { invalidateSchedule } from "@/lib/schedule";
import { cn } from "@/lib/utils";

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

interface UpcomingItem {
  meeting: Meeting;
  company_name: string | null;
  role_title: string | null;
  stage_name: string | null;
  starts_in_minutes: number;
}

type Filter = "interviews" | "bids" | "jobs" | "cancelled";

/** What can be hidden, per portal: each only has the kinds of meeting it can hold. */
const FILTERS: Record<PortalId, readonly (readonly [Filter, string])[]> = {
  remote: [
    ["interviews", "Interviews"],
    ["jobs", "Team meetings"],
    ["cancelled", "Cancelled"],
  ],
  freelancing: [
    ["bids", "Client calls"],
    ["jobs", "Team meetings"],
    ["cancelled", "Cancelled"],
  ],
};

const TO_BOOK_LIMIT = 6;

/** The calendar of one portal: only its own meetings, whichever owner they hang off. */
export function CalendarPage({ portal }: { portal: PortalId }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<DayKey>(() => todayKey());
  const [miniMonth, setMiniMonth] = useState<DayKey>(anchor);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dialog, setDialog] = useState<MeetingDialogState>(null);
  const [show, setShow] = useState<Record<Filter, boolean>>({
    interviews: true,
    bids: true,
    jobs: true,
    cancelled: true,
  });

  const days = useMemo(
    () =>
      view === "day" ? [anchor] : view === "week" ? weekOf(anchor) : monthGrid(anchor),
    [view, anchor],
  );
  const from = days[0];
  const to = days[days.length - 1];

  const { data, isFetching } = useQuery({
    queryKey: ["meetings", from, to, portal],
    queryFn: () =>
      request<Meeting[]>(`/api/v1/shared/meetings?from=${from}&to=${to}&category=${portal}`),
    // Keep the previous grid on screen while the next range loads, so paging
    // does not blink through an empty week.
    placeholderData: keepPreviousData,
  });
  const meetings = useMemo(
    () =>
      (data ?? []).filter(
        (m) =>
          (m.stage_id ? show.interviews : m.freelance_track_id ? show.bids : show.jobs) &&
          (show.cancelled || m.status !== "cancelled"),
      ),
    [data, show],
  );

  // The headline numbers always describe this week, wherever the grid is paged
  // to. Same key as the grid when it is on this week, so it is one request.
  const thisWeek = useMemo(() => weekOf(todayKey()), []);
  const weekQuery = useQuery({
    queryKey: ["meetings", thisWeek[0], thisWeek[6], portal],
    queryFn: () =>
      request<Meeting[]>(
        `/api/v1/shared/meetings?from=${thisWeek[0]}&to=${thisWeek[6]}&category=${portal}`,
      ),
  });

  const upcoming = useQuery({
    queryKey: ["upcoming", "calendar", portal],
    queryFn: () =>
      request<UpcomingItem[]>(`/api/v1/shared/meetings/upcoming?limit=5&category=${portal}`),
    refetchInterval: 60_000,
  });

  const applications = useQuery({
    queryKey: ["applications", "all"],
    queryFn: () => request<{ items: ApplicationRow[] }>("/api/v1/remote/applications"),
    // Only Remote has applications waiting on a call to be booked.
    enabled: portal === "remote",
  });
  // Active applications whose next step has no call booked.
  const toBook = useMemo(
    () =>
      (applications.data?.items ?? []).flatMap((row) => {
        if (CLOSED_STATUSES.has(row.status) || row.status === "saved") return [];
        const stage = currentStage(row.stages);
        return stage && !stage.meetings.some((m) => m.status === "scheduled")
          ? [{ row, stage }]
          : [];
      }),
    [applications.data],
  );

  const stats = useMemo(() => {
    if (!weekQuery.data) return undefined;
    const today = todayKey();
    const live = weekQuery.data.filter((m) => m.status !== "cancelled");
    const figures = [
      { value: live.length, label: "This week" },
      { value: live.filter((m) => dayOf(m) === today).length, label: "Today" },
    ];
    if (portal === "remote") {
      if (applications.data) figures.push({ value: toBook.length, label: "To book" });
    } else {
      figures.push({
        value: weekQuery.data.length - live.length,
        label: "Cancelled",
      });
    }
    return figures;
  }, [weekQuery.data, portal, applications.data, toBook.length]);

  const patch = useMutation({
    mutationFn: ({ id, body }: PatchVariables) =>
      request<Meeting>(`/api/v1/shared/meetings/${id}`, {
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
      invalidateSchedule(queryClient);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(`/api/v1/shared/meetings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelected(null);
      invalidateSchedule(queryClient);
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

  const resize = useCallback(
    (meeting: Meeting, duration: number) => {
      patch.mutate({
        id: meeting.id,
        body: { duration_min: duration },
        optimistic: {
          starts_at: meeting.starts_at,
          ends_at: new Date(
            new Date(meeting.starts_at).getTime() + duration * 60_000,
          ).toISOString(),
        },
      });
    },
    [patch],
  );

  const create = useCallback((day: DayKey, minutes?: number, duration?: number) => {
    setSelected(null);
    setDialog({
      mode: "create",
      draft: { date: day, minutes, duration: duration || undefined },
    });
  }, []);

  const edit = useCallback((meeting: Meeting) => {
    setSelected(null);
    setDialog({ mode: "edit", meeting });
  }, []);

  // New meetings default to today when it is on screen, else the anchor.
  const createHere = useCallback(
    () => create(days.includes(todayKey()) ? todayKey() : anchor),
    [create, days, anchor],
  );

  // The mini calendar follows whatever the main grid is showing.
  useEffect(() => setMiniMonth(anchor), [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      switch (event.key.toLowerCase()) {
        case "n":
        case "c":
          createHere();
          break;
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
  }, [step, dialog, createHere]);

  const highlighted = useMemo(
    () => new Set<DayKey>(view === "month" ? [] : days),
    [view, days],
  );
  const busyDays = useMemo(() => new Set(meetings.map(dayOf)), [meetings]);

  const showUpNext = (index: number, item: UpcomingItem) =>
    selected?.meeting.id === item.meeting.id || (index === 0 && !selected && item.starts_in_minutes <= 60);

  return (
    <div className="space-y-7">
      <PageHero
        title="Calendar"
        stats={stats}
        actions={
          <Button
            variant="brand"
            onClick={createHere}
            title="New meeting (N)"
            className="h-[52px] gap-2.5 pr-6 pl-2 text-[0.9375rem]"
          >
            <span className="grid size-[38px] place-items-center rounded-full bg-black/12">
              <Plus className="size-[18px]" />
            </span>
            New meeting
          </Button>
        }
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19.25rem] lg:items-start">
        <div className="min-w-0 space-y-5">
          {view === "month" ? (
            <MonthGrid
              anchor={anchor}
              days={days}
              meetings={meetings}
              selectedId={selected?.meeting.id ?? null}
              onSelect={(meeting, rect) => setSelected({ meeting, anchor: rect })}
              onEdit={edit}
              onCreate={(day) => create(day)}
              onPickDay={openDay}
            />
          ) : (
            <TimeGrid
              days={days}
              meetings={meetings}
              selectedId={selected?.meeting.id ?? null}
              onSelect={(meeting, rect) => setSelected({ meeting, anchor: rect })}
              onMove={move}
              onResize={resize}
              onCreate={create}
              onEdit={edit}
              onPickDay={openDay}
            />
          )}

          <ShortcutBar />
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24">
          <MiniMonth
            month={miniMonth}
            selected={anchor}
            highlighted={highlighted}
            busyDays={busyDays}
            onMonth={setMiniMonth}
            onPick={(day) => setAnchor(day)}
          >
            <div className="mb-3 flex items-center gap-2">
              <SlidersHorizontal className="text-muted-foreground size-[15px]" />
              <span className="text-sm font-bold">Show</span>
            </div>
            <div className="space-y-3">
              {FILTERS[portal].map(([key, label]) => (
                <div key={key} className="flex items-center gap-2.5">
                  <Checkbox
                    id={`show-${key}`}
                    checked={show[key]}
                    onCheckedChange={(checked) =>
                      setShow((current) => ({ ...current, [key]: checked === true }))
                    }
                  />
                  <Label htmlFor={`show-${key}`} className="text-sm font-semibold">
                    {label}
                  </Label>
                  <FilterKey filter={key} />
                </div>
              ))}
            </div>
          </MiniMonth>

          <Card tone="dark" className="gap-0 px-3.5 pt-[22px] pb-3.5">
            <div className="mb-3.5 flex items-center gap-2.5 px-2.5">
              <Tile icon={CalendarClock} tone="neutral" className="bg-panel-raised text-panel-foreground size-9 rounded-full" />
              <h3 className="text-[1.1875rem] font-medium">Up next</h3>
            </div>
            {!upcoming.data?.length ? (
              <p className="text-panel-muted px-2.5 pb-2 text-sm leading-relaxed">
                Nothing booked ahead.
              </p>
            ) : (
              <ul>
                {upcoming.data.map((item, index) => (
                  <li key={item.meeting.id} className={cn(index > 0 && "mt-0.5")}>
                    <button
                      type="button"
                      className={cn(
                        "hover:bg-panel-raised/60 flex w-full items-center gap-2.5 rounded-2xl px-3 py-[9px] text-left transition-colors",
                        showUpNext(index, item) && "bg-panel-raised hover:bg-panel-raised",
                      )}
                      onClick={(event) => {
                        setAnchor(dayOf(item.meeting));
                        setSelected({
                          meeting: {
                            ...item.meeting,
                            company_name: item.company_name,
                            role_title: item.role_title,
                            stage_name: item.stage_name,
                          },
                          anchor: event.currentTarget.getBoundingClientRect(),
                        });
                      }}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-[4px]"
                        style={{ backgroundColor: eventColor(item.meeting.meeting_type).fill }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.90rem] font-semibold">
                          {item.meeting.title}
                        </span>
                        <span className="text-panel-muted mt-px block text-[0.78rem] tabular-nums">
                          {formatDateTime(item.meeting.starts_at, "EEE d MMM, h:mm aaa")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[0.78rem] font-bold whitespace-nowrap",
                          showUpNext(index, item) ? "text-brand" : "text-panel-foreground/80",
                        )}
                      >
                        {relative(item.starts_in_minutes)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {portal === "remote" && (
            <Card className="gap-0 px-[22px] pt-[22px] pb-5">
              <div className="mb-3.5 flex items-center gap-2.5">
                <Tile icon={CalendarPlus} size="sm" />
                <h3 className="text-[1.1875rem] font-medium">Still to book</h3>
                {toBook.length > 0 && (
                  <span className="text-muted-foreground border-foreground ml-auto border-b-[1.5px] pb-px text-[13px] font-semibold">
                    {toBook.length}
                  </span>
                )}
              </div>
              {!toBook.length ? (
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {applications.isLoading
                    ? "Checking your applications…"
                    : "Every active application has its next step booked."}
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {toBook.slice(0, TO_BOOK_LIMIT).map(({ row, stage }) => (
                    <li key={row.id} className="flex items-center gap-3 py-[11px] last:pb-0">
                      <Tile tone="ink" className="size-9 rounded-xl text-[0.9375rem]">
                        {row.company_name.charAt(0).toUpperCase()}
                      </Tile>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{row.company_name}</p>
                        <p className="text-muted-foreground truncate text-[0.8rem]">
                          {stage.name}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          setDialog({ mode: "create", draft: { stageId: stage.id } })
                        }
                      >
                        Book
                      </Button>
                    </li>
                  ))}
                  {toBook.length > TO_BOOK_LIMIT && (
                    <li className="pt-3">
                      <Link
                        href="/remote/applications"
                        className="text-muted-foreground text-xs font-semibold hover:underline"
                      >
                        {toBook.length - TO_BOOK_LIMIT} more in Applications
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </Card>
          )}
        </aside>
      </div>

      {selected && (
        <EventPopover
          meeting={selected.meeting}
          anchor={selected.anchor}
          pending={patch.isPending || remove.isPending}
          onPatch={(body) => patch.mutate({ id: selected.meeting.id, body })}
          onEdit={() => edit(selected.meeting)}
          onDelete={() => remove.mutate(selected.meeting.id)}
          onClose={() => setSelected(null)}
        />
      )}

      <MeetingDialog state={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/** The colour (or outline) a filter's meetings are drawn in, at the end of its row. */
function FilterKey({ filter }: { filter: Filter }) {
  return filter === "cancelled" ? (
    <span aria-hidden className="ml-auto size-2.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--subtle)]" />
  ) : (
    <span
      aria-hidden
      className="ml-auto size-2.5 rounded-full"
      style={{
        backgroundColor:
          filter === "jobs" ? "var(--event-4)" : "var(--event-1)",
        boxShadow: filter === "jobs" ? "inset 0 0 0 1px rgb(0 0 0 / 0.08)" : undefined,
      }}
    />
  );
}

const SHORTCUTS: [string[], string][] = [
  [["N"], "New meeting"],
  [["T"], "Jump to today"],
  [["D", "W", "M"], "Day, week or month"],
  [["←", "→"], "Page back and forward"],
];

/** The keyboard legend under the grid: a slim translucent pill. */
function ShortcutBar() {
  return (
    <div className="bg-card/55 text-muted-foreground hidden flex-wrap items-center gap-x-3 gap-y-2 rounded-[2rem] px-5 py-4 text-[0.78rem] font-medium lg:flex">
      {SHORTCUTS.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-2">
          <span className="flex gap-1">
            {keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
          {label}
        </span>
      ))}
      <span className="text-subtle ml-auto">Double-click to edit · US Eastern</span>
    </div>
  );
}

/** A key cap. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-card text-foreground/70 inline-flex min-w-6 items-center justify-center rounded-lg px-[7px] py-0.5 text-xs font-bold shadow-[inset_0_0_0_1px_var(--border)]">
      {children}
    </kbd>
  );
}
