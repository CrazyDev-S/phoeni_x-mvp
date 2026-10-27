import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  Plus,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  addDays,
  dayLabel,
  FALLBACK_TIME_ZONE,
  MEETING_STATUSES,
  statusLabel,
  timeLabel,
  todayKey,
  weekOf,
  zoneAbbreviation,
  zoned,
  type DayKey,
  type Meeting,
} from "@/lib/calendar";
import { NEXT_CALL_KEY } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Section } from "../chrome-shell";
import { ErrorNote, type Upcoming } from "../components";
import { MeetingForm, type MeetingFormState } from "./calendar/MeetingForm";

/** Who a meeting is with, as a colour down its card. */
const KIND_BAR: Record<string, string> = {
  application: "bg-primary",
  maintained: "bg-info",
  freelance: "bg-success",
};

/** The pinned next call, refreshed now rather than on the worker's next alarm. */
async function refreshNextCall(): Promise<void> {
  const next = await api<Upcoming | null>("/api/v1/shared/meetings/next").catch(() => undefined);
  if (next !== undefined) await chrome.storage.local.set({ [NEXT_CALL_KEY]: next });
}

/**
 * A week strip over a day's agenda - a month grid does not fit ~360px - and the
 * portal's meeting form for adding or editing one.
 */
export function CalendarTab({ portalUrl }: { portalUrl: string }) {
  const [zone, setZone] = useState(FALLBACK_TIME_ZONE);
  const [day, setDay] = useState(() => todayKey(FALLBACK_TIME_ZONE));
  const [week, setWeek] = useState<Meeting[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<MeetingFormState | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const days = weekOf(day);
  const monday = days[0];
  const today = todayKey(zone);

  useEffect(() => {
    // Meetings are booked in the display zone set in the portal, so the panel
    // draws its days there too.
    void api<{ display_timezone?: string }>("/api/v1/settings")
      .then((s) => {
        if (!s.display_timezone || s.display_timezone === FALLBACK_TIME_ZONE) return;
        const zoneToday = todayKey(s.display_timezone);
        setZone(s.display_timezone);
        setDay((d) => (d === todayKey(FALLBACK_TIME_ZONE) ? zoneToday : d));
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (from: DayKey) => {
    setBusy(true);
    try {
      setWeek(await api<Meeting[]>(`/api/v1/shared/meetings?from=${from}&to=${addDays(from, 6)}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => void load(monday), [monday, load]);

  async function setStatus(id: string, status: string) {
    // Optimistic: the panel is often used while a call is starting.
    setWeek((list) => list.map((m) => (m.id === id ? { ...m, status } : m)));
    try {
      await api(`/api/v1/shared/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      void refreshNextCall();
    } catch (e) {
      setError((e as Error).message);
      void load(monday);
    }
  }

  function saved(on: DayKey) {
    setForm(null);
    void refreshNextCall();
    // Show the day the meeting landed on; the week reloads if it moved.
    if (weekOf(on)[0] === monday) void load(monday);
    setDay(on);
  }

  if (form) {
    return (
      <MeetingForm
        state={form}
        timeZone={zone}
        portalUrl={portalUrl}
        onSaved={saved}
        onCancel={() => setForm(null)}
      />
    );
  }

  const agenda = week.filter((m) => zoned(m.starts_at, zone).day === day);
  const counts = new Map<DayKey, number>();
  for (const m of week) {
    if (m.status === "cancelled") continue;
    const key = zoned(m.starts_at, zone).day;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-0 py-0">
        <CardContent className="space-y-2 p-2.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="hover:bg-muted flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold"
              onClick={() => {
                try {
                  picker.current?.showPicker();
                } catch {
                  picker.current?.focus();
                }
              }}
            >
              {dayLabel(day, { month: "long", year: "numeric" })}
              <ChevronDown className="text-muted-foreground size-3.5" />
            </button>
            <input
              ref={picker}
              type="date"
              tabIndex={-1}
              aria-label="Jump to a day"
              className="sr-only"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Previous week"
                onClick={() => setDay(addDays(day, -7))}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={day === today}
                onClick={() => setDay(today)}
              >
                Today
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Next week"
                onClick={() => setDay(addDays(day, 7))}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((key) => {
              const selected = key === day;
              const count = counts.get(key) ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${dayLabel(key, { weekday: "long", month: "long", day: "numeric" })}${count ? `, ${count} meeting${count === 1 ? "" : "s"}` : ""}`}
                  onClick={() => setDay(key)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors outline-none focus-visible:ring-3",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : key === today
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "text-[10px] font-medium uppercase",
                      !selected && key !== today && "text-subtle",
                    )}
                  >
                    {dayLabel(key, { weekday: "narrow" })}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {Number(key.slice(8))}
                  </span>
                  <span className="flex h-1 gap-0.5">
                    {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "size-1 rounded-full",
                          selected ? "bg-primary-foreground" : "bg-primary",
                        )}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title={
          day === today
            ? `Today · ${dayLabel(day, { month: "short", day: "numeric" })}`
            : dayLabel(day, { weekday: "long", month: "short", day: "numeric" })
        }
        action={
          <Button size="xs" onClick={() => setForm({ mode: "create", date: day })}>
            <Plus />
            Add meeting
          </Button>
        }
      >
        {busy ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : !agenda.length ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-3 py-6 text-center">
            <CalendarPlus className="size-4" />
            <p className="text-[11px]">Nothing scheduled on this day.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setForm({ mode: "create", date: day })}
            >
              <Plus />
              Schedule a meeting
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {agenda.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                timeZone={zone}
                onStatus={(status) => void setStatus(m.id, status)}
                onEdit={() => setForm({ mode: "edit", meeting: m })}
              />
            ))}
          </ul>
        )}
      </Section>

      <p className="text-subtle text-center text-[10px]">
        Times in {zoneAbbreviation(day, zone)} · set the zone in the portal&rsquo;s Settings.
      </p>
    </div>
  );
}

function MeetingCard({
  meeting: m,
  timeZone,
  onStatus,
  onEdit,
}: {
  meeting: Meeting;
  timeZone: string;
  onStatus: (status: string) => void;
  onEdit: () => void;
}) {
  const cancelled = m.status === "cancelled";
  const now = Date.now();
  const starts = Date.parse(m.starts_at);
  const live = !cancelled && starts <= now && now < Date.parse(m.ends_at);
  const soon = !cancelled && starts > now && starts - now <= 60 * 60_000;
  const owner = [m.company_name, m.stage_name ?? m.role_title].filter(Boolean).join(" · ");

  return (
    <li className={cn("bg-card rounded-xl border", live && "border-primary/50")}>
      <div className="flex gap-2.5 p-3">
        <div className="w-15 shrink-0 text-right">
          <p className="text-xs font-semibold tabular-nums">{timeLabel(m.starts_at, timeZone)}</p>
          <p className="text-subtle text-[10px] tabular-nums">{timeLabel(m.ends_at, timeZone)}</p>
        </div>
        <span
          aria-hidden
          className={cn(
            "w-0.5 shrink-0 rounded-full",
            cancelled ? "bg-border" : (KIND_BAR[m.kind ?? ""] ?? "bg-primary"),
          )}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <p
              className={cn(
                "min-w-0 flex-1 text-xs leading-snug font-semibold",
                cancelled && "text-muted-foreground line-through",
              )}
            >
              {m.title}
            </p>
            {live && <Badge className="h-4 px-1.5 text-[10px]">Now</Badge>}
            {soon && (
              <span className="text-primary shrink-0 text-[10px] font-semibold tabular-nums">
                in {Math.max(1, Math.round((starts - now) / 60_000))}m
              </span>
            )}
          </div>
          {owner && <p className="text-muted-foreground truncate text-[11px]">{owner}</p>}
          {m.location && (
            <p className="text-muted-foreground flex items-center gap-1 truncate text-[11px]">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{m.location}</span>
            </p>
          )}
          {m.preparation_notes && (
            <p className="text-muted-foreground line-clamp-3 border-l-2 pl-2 text-[11px] leading-relaxed">
              {m.preparation_notes}
            </p>
          )}
          <div className="flex items-center gap-1.5 pt-0.5">
            <Select value={m.status} onValueChange={onStatus}>
              <SelectTrigger size="sm" aria-label="Status" className="min-w-0 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEETING_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {m.conferencing_url && !cancelled && (
              <Button asChild size="sm" variant={live || soon ? "default" : "outline"}>
                <a href={m.conferencing_url} target="_blank" rel="noreferrer">
                  <Video />
                  Join
                </a>
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${m.title}`} onClick={onEdit}>
              <Pencil />
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
