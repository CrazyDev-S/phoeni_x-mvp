import type { QueryClient } from "@tanstack/react-query";

import type { Tone } from "@/components/status-badge";

/**
 * Every query that shows a meeting or a stage status.
 *
 * Booking one call moves a calendar block, a tracking-table cell, the next-call
 * banner and the application's own page at once, so a write refreshes all of
 * them rather than only whichever the caller happened to be looking at.
 */
const SCHEDULE_QUERIES = ["meetings", "next-call", "upcoming", "applications", "application"];

export function invalidateSchedule(queryClient: QueryClient) {
  for (const key of SCHEDULE_QUERIES) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export const MEETING_STATUSES = ["scheduled", "held", "cancelled", "rescheduled", "no_show"];

const MEETING_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: "Scheduled", tone: "brand" },
  held: { label: "Held", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
  rescheduled: { label: "Rescheduled", tone: "warn" },
  no_show: { label: "No-show", tone: "warn" },
};

export function meetingStatus(status: string): { label: string; tone: Tone } {
  return MEETING_STATUS[status] ?? { label: humanize(status), tone: "neutral" };
}

/** "recruiter_screen" → "Recruiter screen". */
export function humanize(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
