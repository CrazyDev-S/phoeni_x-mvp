import { formatInTimeZone } from "date-fns-tz";

/** Everything the user sees is rendered in their display zone, never the browser's. */
export const DISPLAY_TIME_ZONE = "America/New_York";

export function formatDateTime(
  iso: string,
  pattern = "EEE d MMM, HH:mm zzz",
  timeZone = DISPLAY_TIME_ZONE,
) {
  return formatInTimeZone(new Date(iso), timeZone, pattern);
}

export function formatDay(iso: string, timeZone = DISPLAY_TIME_ZONE) {
  return formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd");
}

export function formatTime(iso: string, timeZone = DISPLAY_TIME_ZONE) {
  return formatInTimeZone(new Date(iso), timeZone, "HH:mm");
}

export function relative(minutes: number): string {
  if (minutes < 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/** Highlight anything inside the next 48 hours — the thing you must not miss. */
export const IMMINENT_MINUTES = 48 * 60;
