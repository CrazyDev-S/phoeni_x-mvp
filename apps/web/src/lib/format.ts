import { formatInTimeZone } from "date-fns-tz";

/** Everything the user sees is rendered in their display zone, never the browser's. */
export const APP_TZ = "America/New_York";

export function fmt(iso: string, pattern = "EEE d MMM, HH:mm zzz", tz = APP_TZ) {
  return formatInTimeZone(new Date(iso), tz, pattern);
}

export function fmtDay(iso: string, tz = APP_TZ) {
  return formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd");
}

export function fmtTime(iso: string, tz = APP_TZ) {
  return formatInTimeZone(new Date(iso), tz, "HH:mm");
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
