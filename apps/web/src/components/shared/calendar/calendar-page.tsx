"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CLOSED_STATUSES,
  currentStage,
  type ApplicationRow,
} from "@/components/remote/applications/shared";
import { EventPopover } from "@/components/shared/calendar/event-popover";
import { MeetingDialog, type MeetingDialogState } from "@/components/shared/calendar/meeting-dialog";
import { MonthGrid } from "@/components/shared/calendar/month-grid";
import { TimeGrid } from "@/components/shared/calendar/time-grid";
import { rangeTitle, Toolbar, type CalendarView } from "@/components/shared/calendar/toolbar";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { PortalId } from "@/lib/portals";
import { invalidateSchedule } from "@/lib/schedule";

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

  return (
    <div className="space-y-3">
      <PageHero
        title="Calendar"
        stats={stats}
        actions={
          <Button variant="brand" onClick={createHere} title="New meeting (N)">
            <Plus />
            New meeting
          </Button>
        }
      />

      <Toolbar
        view={view}
        title={rangeTitle(view, anchor, days)}
        busy={isFetching}
        onView={setView}
        onToday={() => setAnchor(todayKey())}
        onStep={step}
      >
        {FILTERS[portal].map(([key, label]) => (
          <Chip
            key={key}
            size="sm"
            active={show[key]}
            onClick={() => setShow((current) => ({ ...current, [key]: !current[key] }))}
          >
            <FilterKey filter={key} />
            {label}
          </Chip>
        ))}
        {portal === "remote" && toBook.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                To book
                <span className="text-muted-foreground tabular-nums">{toBook.length}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {toBook.slice(0, TO_BOOK_LIMIT).map(({ row, stage }) => (
                <DropdownMenuItem
                  key={row.id}
                  onSelect={() => setDialog({ mode: "create", draft: { stageId: stage.id } })}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{row.company_name}</span>
                  <span className="text-muted-foreground truncate text-xs">{stage.name}</span>
                </DropdownMenuItem>
              ))}
              {toBook.length > TO_BOOK_LIMIT && (
                <DropdownMenuItem asChild>
                  <Link href="/remote/applications" className="text-muted-foreground text-xs">
                    {toBook.length - TO_BOOK_LIMIT} more in Applications
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Toolbar>

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
    <span aria-hidden className="size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--subtle)]" />
  ) : (
    <span
      aria-hidden
      className="size-2 rounded-full"
      style={{
        backgroundColor:
          filter === "jobs" ? "var(--event-4)" : "var(--event-1)",
        boxShadow: filter === "jobs" ? "inset 0 0 0 1px rgb(0 0 0 / 0.08)" : undefined,
      }}
    />
  );
}
