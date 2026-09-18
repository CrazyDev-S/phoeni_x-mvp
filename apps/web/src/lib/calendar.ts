/**
 * Calendar arithmetic, event geometry, and event colour.
 *
 * The grid is drawn in the display zone, never the browser's, so somebody
 * travelling sees the same week as the meetings they are looking at. A civil
 * date is a plain "yyyy-MM-dd" key; the arithmetic runs on a Date pinned to
 * noon UTC, which no zone offset can push into the neighbouring day.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { DISPLAY_TIME_ZONE, formatDay } from "./format";

export type DayKey = string;

export const MINUTES_PER_DAY = 1440;
const DAY_MS = 86_400_000;

export interface Meeting {
  id: string;
  title: string;
  meeting_type: string;
  starts_at: string;
  ends_at: string;
  display_timezone: string;
  status: string;
  location: string | null;
  conferencing_url: string | null;
  agenda: string | null;
  preparation_notes: string | null;
  notes: string | null;
  stage_id: string | null;
  maintained_job_id: string | null;
  series_id: string | null;
  is_exception: boolean;
  reminder_minutes: number;
  // Who the meeting is with. Present on calendar reads; absent where a meeting
  // is nested under the stage that already says so.
  kind?: string;
  application_id?: string | null;
  company_name?: string | null;
  role_title?: string | null;
  stage_name?: string | null;
  stage_kind?: string | null;
}

function civil(key: DayKey): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Safe because every civil Date sits at noon UTC. */
function keyOf(date: Date): DayKey {
  return date.toISOString().slice(0, 10);
}

export function todayKey(now: Date = new Date()): DayKey {
  return formatInTimeZone(now, DISPLAY_TIME_ZONE, "yyyy-MM-dd");
}

export function addDays(key: DayKey, days: number): DayKey {
  return keyOf(new Date(civil(key).getTime() + days * DAY_MS));
}

export function addMonths(key: DayKey, months: number): DayKey {
  const date = civil(key);
  const first = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12),
  );
  // Clamp, so 31 January plus one month is the last day of February rather
  // than sliding into March.
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return keyOf(first);
}

/** Monday-first, matching the rest of the product. */
export function startOfWeek(key: DayKey): DayKey {
  return addDays(key, -((civil(key).getUTCDay() + 6) % 7));
}

export function weekOf(key: DayKey): DayKey[] {
  const monday = startOfWeek(key);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** Whole weeks covering the anchor's month — five rows, or six when it spills. */
export function monthGrid(key: DayKey): DayKey[] {
  const date = civil(key);
  const first = keyOf(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12)));
  const last = keyOf(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)),
  );
  const start = startOfWeek(first);
  const span = Math.round((civil(last).getTime() - civil(start).getTime()) / DAY_MS) + 1;
  const length = Math.ceil(span / 7) * 7;
  return Array.from({ length }, (_, index) => addDays(start, index));
}

export function dayLabel(key: DayKey, pattern: string): string {
  return formatInTimeZone(civil(key), "UTC", pattern);
}

export function isSameMonth(a: DayKey, b: DayKey): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Minutes since local midnight in the display zone. */
export function minutesInto(iso: string): number {
  const [hours, minutes] = formatInTimeZone(new Date(iso), DISPLAY_TIME_ZONE, "HH:mm")
    .split(":")
    .map(Number);
  return hours * 60 + minutes;
}

export function durationMinutes(meeting: Meeting): number {
  const span =
    (new Date(meeting.ends_at).getTime() - new Date(meeting.starts_at).getTime()) / 60_000;
  return Math.max(Math.round(span), 5);
}

export function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The zone as the user reads it on the day in question — EST or EDT. */
export function zoneAbbreviation(key: DayKey): string {
  return formatInTimeZone(civil(key), DISPLAY_TIME_ZONE, "zzz");
}

/** The instant a local wall-clock slot maps to — used for optimistic moves. */
export function instantAt(day: DayKey, minutes: number): string {
  return fromZonedTime(
    `${day}T${minutesLabel(minutes)}:00`,
    DISPLAY_TIME_ZONE,
  ).toISOString();
}

export function dayOf(meeting: Meeting): DayKey {
  return formatDay(meeting.starts_at);
}

export interface Placement {
  meeting: Meeting;
  startMinutes: number;
  endMinutes: number;
  column: number;
  columns: number;
}

/**
 * Side-by-side geometry for one day's column.
 *
 * Meetings that overlap in time form a cluster and split the column evenly;
 * a meeting that starts after every cluster member has ended begins a new
 * cluster and gets the full width back.
 */
export function placeDay(
  meetings: Meeting[],
  spanOf: (meeting: Meeting) => { start: number; end: number },
): Placement[] {
  const spans = meetings
    .map((meeting) => ({ meeting, ...spanOf(meeting) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: Placement[] = [];
  let cluster: Placement[] = [];
  let columnEnds: number[] = [];

  const flush = () => {
    for (const entry of cluster) entry.columns = columnEnds.length;
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const span of spans) {
    // A 15-minute floor keeps two back-to-back short meetings from being
    // laid out on top of each other once they are padded to a legible height.
    const end = Math.max(span.end, span.start + 15);
    if (cluster.length && span.start >= Math.max(...columnEnds)) flush();

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= span.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    cluster.push({
      meeting: span.meeting,
      startMinutes: span.start,
      endMinutes: end,
      column,
      columns: 1,
    });
  }
  flush();
  return placed;
}

export interface EventColor {
  /** Background of a filled block. */
  fill: string;
  /** Text that sits on `fill`. */
  foreground: string;
  /** Text and border when the block is drawn as an outline instead. */
  ink: string;
}

/**
 * Muted hues, so a full week still reads as one surface rather than confetti.
 *
 * Each entry points at theme tokens rather than a literal colour: the same
 * meeting has to stay legible on a white canvas and on a near-black one, and
 * only CSS knows which of those is on screen.
 */
const PALETTE: EventColor[] = Array.from({ length: 6 }, (_, index) => ({
  fill: `var(--event-${index + 1})`,
  foreground: `var(--event-${index + 1}-foreground)`,
  ink: `var(--event-${index + 1}-ink)`,
}));

const COLOR_BY_TYPE: Record<string, number> = {
  interview: 0,
  technical: 0,
  onsite: 4,
  screening: 1,
  recruiter_screen: 1,
  phone_screen: 1,
  panel: 2,
  one_on_one: 2,
  team_sync: 3,
  standup: 3,
  offer: 5,
};

export function eventColor(meetingType: string): EventColor {
  const index =
    COLOR_BY_TYPE[meetingType] ??
    [...meetingType].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length;
  return PALETTE[index];
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
