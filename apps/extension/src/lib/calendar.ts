/**
 * Calendar arithmetic for the panel, without a date library.
 *
 * Meetings are drawn in the user's display zone (Settings in the portal), never
 * the browser's, so the panel and the portal show the same day. A civil date is
 * a plain "yyyy-MM-dd" key; arithmetic runs on a Date pinned to noon UTC, which
 * no zone offset can push into the neighbouring day.
 */

export type DayKey = string;

export const FALLBACK_TIME_ZONE = "America/New_York";
const DAY_MS = 86_400_000;

export interface Meeting {
  id: string;
  title: string;
  meeting_type: string;
  starts_at: string;
  ends_at: string;
  status: string;
  location: string | null;
  conferencing_url: string | null;
  agenda: string | null;
  preparation_notes: string | null;
  notes: string | null;
  series_id: string | null;
  reminder_minutes: number;
  /** application | maintained | freelance */
  kind?: string;
  company_name?: string | null;
  role_title?: string | null;
  stage_name?: string | null;
}

export const MEETING_STATUSES = ["scheduled", "held", "cancelled", "rescheduled", "no_show"];

export function statusLabel(status: string): string {
  if (status === "no_show") return "No-show";
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function civil(key: DayKey): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function keyOf(date: Date): DayKey {
  return date.toISOString().slice(0, 10);
}

/** The civil date and minutes past midnight of an instant, in a zone. */
export function zoned(iso: string | Date, timeZone: string): { day: DayKey; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(typeof iso === "string" ? new Date(iso) : iso)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function todayKey(timeZone: string): DayKey {
  return zoned(new Date(), timeZone).day;
}

export function addDays(key: DayKey, days: number): DayKey {
  return keyOf(new Date(civil(key).getTime() + days * DAY_MS));
}

/** Monday-first, matching the portal. */
export function weekOf(key: DayKey): DayKey[] {
  const monday = addDays(key, -((civil(key).getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function dayLabel(key: DayKey, options: Intl.DateTimeFormatOptions): string {
  return civil(key).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** "14:30" from minutes past midnight - the API's local_time. */
export function clock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** "2:30 PM" for display. */
export function timeLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function durationMinutes(meeting: Pick<Meeting, "starts_at" | "ends_at">): number {
  return Math.round((Date.parse(meeting.ends_at) - Date.parse(meeting.starts_at)) / 60_000);
}

export function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/** "EDT", "GMT+7" - what the zone is called on that day. */
export function zoneAbbreviation(key: DayKey, timeZone: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(civil(key))
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone
  );
}
