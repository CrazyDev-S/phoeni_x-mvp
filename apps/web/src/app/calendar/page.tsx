"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CalendarClock, CalendarDays, CalendarPlus, Keyboard, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CLOSED_STATUSES,
  currentStage,
  type ApplicationRow,
} from "@/components/applications/shared";
import { EventPopover } from "@/components/calendar/event-popover";
import { MeetingDialog, type MeetingDialogState } from "@/components/calendar/meeting-dialog";
import { MiniMonth } from "@/components/calendar/mini-month";
import { MonthGrid } from "@/components/calendar/month-grid";
import { TimeGrid } from "@/components/calendar/time-grid";
import { rangeTitle, Toolbar, type CalendarView } from "@/components/calendar/toolbar";
import { NextCallBanner } from "@/components/next-call";
import { PageHero } from "@/components/page-hero";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { formatDateTime, relative } from "@/lib/format";
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

const FILTERS = [
  ["interviews", "Interviews"],
  ["jobs", "Team meetings"],
  ["cancelled", "Cancelled"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const TO_BOOK_LIMIT = 6;

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<DayKey>(() => todayKey());
  const [miniMonth, setMiniMonth] = useState<DayKey>(anchor);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dialog, setDialog] = useState<MeetingDialogState>(null);
  const [show, setShow] = useState<Record<Filter, boolean>>({
    interviews: true,
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
    queryKey: ["meetings", from, to],
    queryFn: () => request<Meeting[]>(`/api/v1/meetings?from=${from}&to=${to}`),
    // Keep the previous grid on screen while the next range loads, so paging
    // does not blink through an empty week.
    placeholderData: keepPreviousData,
  });
  const meetings = useMemo(
    () =>
      (data ?? []).filter(
        (m) =>
          (m.stage_id ? show.interviews : show.jobs) &&
          (show.cancelled || m.status !== "cancelled"),
      ),
    [data, show],
  );

  const upcoming = useQuery({
    queryKey: ["upcoming", "calendar"],
    queryFn: () => request<UpcomingItem[]>("/api/v1/meetings/upcoming?limit=5"),
    refetchInterval: 60_000,
  });

  const applications = useQuery({
    queryKey: ["applications", "all"],
    queryFn: () => request<{ items: ApplicationRow[] }>("/api/v1/applications"),
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
      invalidateSchedule(queryClient);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => request(`/api/v1/meetings/${id}`, { method: "DELETE" }),
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

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Schedule"
        eyebrowIcon={CalendarDays}
        title="Calendar"
        description="Interviews and team meetings in one place. Click or drag across empty time to schedule; drag a meeting to move it, or its bottom edge to change its length."
      />

      <NextCallBanner />

      <Toolbar
        view={view}
        title={rangeTitle(view, anchor, days)}
        busy={isFetching}
        onView={setView}
        onToday={() => setAnchor(todayKey())}
        onStep={step}
        onCreate={createHere}
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
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <div className="hidden lg:block">
            <MiniMonth
              month={miniMonth}
              selected={anchor}
              highlighted={highlighted}
              busyDays={busyDays}
              onMonth={setMiniMonth}
              onPick={(day) => setAnchor(day)}
            />
          </div>

          <SidePanel icon={CalendarPlus} title="Still to book">
            {!toBook.length ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {applications.isLoading
                  ? "Checking your applications…"
                  : "Every active application has its next step booked."}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {toBook.slice(0, TO_BOOK_LIMIT).map(({ row, stage }) => (
                  <li key={row.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.company_name}</p>
                      <p className="text-muted-foreground truncate text-xs">{stage.name}</p>
                    </div>
                    <Button
                      size="sm"
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
                  <li>
                    <Link
                      href="/applications"
                      className="text-muted-foreground text-xs hover:underline"
                    >
                      {toBook.length - TO_BOOK_LIMIT} more in Applications
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </SidePanel>

          <SidePanel icon={CalendarClock} title="Up next">
            {!upcoming.data?.length ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                Nothing booked ahead.
              </p>
            ) : (
              <ul className="-mx-2 space-y-1">
                {upcoming.data.map((item) => (
                  <li key={item.meeting.id}>
                    <button
                      type="button"
                      className={cn(
                        "hover:bg-muted w-full rounded-md px-2 py-1.5 text-left transition-colors",
                        selected?.meeting.id === item.meeting.id && "bg-muted",
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
                      <p className="truncate text-sm font-medium">{item.meeting.title}</p>
                      <p className="text-muted-foreground flex justify-between gap-2 text-xs tabular-nums">
                        <span>{formatDateTime(item.meeting.starts_at, "EEE d MMM, HH:mm")}</span>
                        <span>{relative(item.starts_in_minutes)}</span>
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SidePanel>

          <SidePanel icon={SlidersHorizontal} title="Show">
            <div className="space-y-2.5">
              {FILTERS.map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`show-${key}`}
                    checked={show[key]}
                    onCheckedChange={(checked) =>
                      setShow((current) => ({ ...current, [key]: checked === true }))
                    }
                  />
                  <Label htmlFor={`show-${key}`} className="text-sm font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </SidePanel>

          <SidePanel icon={Keyboard} title="Shortcuts" className="hidden lg:flex">
            <ul className="space-y-2.5 text-sm">
              {[
                [["N"], "New meeting"],
                [["T"], "Jump to today"],
                [["D", "W", "M"], "Day, week or month"],
                [["←", "→"], "Page back and forward"],
              ].map(([keys, label]) => (
                <li key={label as string} className="flex items-center gap-3">
                  <span className="flex shrink-0 gap-1">
                    {(keys as string[]).map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                  <span className="text-muted-foreground text-xs">{label}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-4 border-t pt-3 text-xs leading-relaxed">
              Double-click a meeting to edit it. Times are shown in US Eastern and read
              EST or EDT by date.
            </p>
          </SidePanel>
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

/** A key cap, for the shortcut legend in the aside. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 text-[11px] font-medium">
      {children}
    </kbd>
  );
}
