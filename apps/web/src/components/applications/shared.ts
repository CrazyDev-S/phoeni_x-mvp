import {
  Activity,
  Ban,
  CalendarClock,
  Circle,
  CircleCheck,
  CircleX,
  Hourglass,
  Minus,
  RotateCcw,
  UserX,
} from "lucide-react";
import type { ComponentType } from "react";

import type { Tone } from "@/components/status-badge";
import type { Meeting } from "@/lib/calendar";

export interface Stage {
  id: string;
  seq: number;
  name: string;
  kind: string;
  status: string;
  scheduled_for: string | null;
  outcome_notes?: string | null;
  decided_at?: string | null;
  /** Every meeting booked for the stage, earliest first. */
  meetings: Meeting[];
}

export interface ApplicationRow {
  id: string;
  company_name: string;
  company_domain: string | null;
  role_title: string;
  job_url: string | null;
  location: string | null;
  work_mode: string | null;
  status: string;
  origin: string;
  tailored_resume_id: string | null;
  stages: Stage[];
  stage_count: number;
  stages_passed: number;
  must_have_coverage_percent: number | null;
  current_stage: Stage | null;
  next_meeting: Meeting | null;
  applied_at: string | null;
  created_at: string;
}

export interface ResumeFlags {
  uncovered_requirements?: { requirement: string; how_to_close: string }[];
  interview_probes?: { question: string; suggested_answer: string }[];
  must_verify?: string[];
}

export interface TailoredResumeBrief {
  id: string;
  display_name: string;
  base_resume_id: string;
  base_resume_name: string | null;
  status: string;
  job_url: string | null;
  job_source: string;
  must_have_covered: number | null;
  must_have_total: number | null;
  must_have_coverage_percent: number | null;
  nice_to_have_coverage_percent: number | null;
  years_required: number | null;
  years_shown: number | null;
  content_markdown: string;
  flags: ResumeFlags | null;
  created_at: string;
}

export interface ApplicationDetail {
  id: string;
  company_name: string;
  company_domain: string | null;
  role_title: string;
  job_url: string | null;
  location: string | null;
  work_mode: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  status: string;
  origin: string;
  applied_at: string | null;
  next_action_at: string | null;
  notes_markdown: string | null;
  tailored_resume_id: string | null;
  created_at: string;
  job_description_text: string | null;
  stages: Stage[];
  tailored_resume: TailoredResumeBrief | null;
  /** When nothing is linked: the tailored resume written for this posting. */
  suggested_tailored_resume: {
    id: string;
    display_name: string;
    base_resume_id: string;
    must_have_coverage_percent: number | null;
  } | null;
}

export interface StageUpdated {
  stage: Stage;
  application_status: string;
  suggested_next_stage: {
    stage_id: string | null;
    name: string | null;
    kind: string | null;
    already_scheduled: boolean;
    suggested_duration_min: number | null;
  } | null;
}

/** The API's own enum, in the order a search actually moves through it. */
export const STATUSES = [
  "saved",
  "applied",
  "in_process",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
  "ghosted",
] as const;

export const STATUS_TONE: Record<string, Tone> = {
  saved: "neutral",
  applied: "brand",
  in_process: "brand",
  offer: "ok",
  hired: "ok",
  rejected: "bad",
  withdrawn: "neutral",
  ghosted: "warn",
};

export const STATUS_LABEL: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  in_process: "In process",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
};

/** Closed, so there is nothing left to book. */
export const CLOSED_STATUSES = new Set(["hired", "rejected", "withdrawn", "ghosted"]);

/** The stage enum, ahead-of-you states first. */
export const STAGE_STATUSES = [
  "pending",
  "scheduled",
  "in_progress",
  "waiting_feedback",
  "rescheduled",
  "no_show",
  "passed",
  "failed",
  "skipped",
  "cancelled",
];

interface StageStatusMeta {
  label: string;
  tone: Tone;
  Icon: ComponentType<{ className?: string }>;
}

const STAGE_STATUS: Record<string, StageStatusMeta> = {
  pending: { label: "Pending", tone: "neutral", Icon: Circle },
  scheduled: { label: "Scheduled", tone: "brand", Icon: CalendarClock },
  in_progress: { label: "In progress", tone: "brand", Icon: Activity },
  waiting_feedback: { label: "Awaiting feedback", tone: "warn", Icon: Hourglass },
  rescheduled: { label: "Rescheduled", tone: "warn", Icon: RotateCcw },
  no_show: { label: "No-show", tone: "warn", Icon: UserX },
  passed: { label: "Passed", tone: "ok", Icon: CircleCheck },
  failed: { label: "Failed", tone: "bad", Icon: CircleX },
  skipped: { label: "Skipped", tone: "neutral", Icon: Minus },
  cancelled: { label: "Cancelled", tone: "neutral", Icon: Ban },
};

/** Label, tone and icon — status is never carried by colour alone. */
export function stageStatus(status: string): StageStatusMeta {
  return (
    STAGE_STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "neutral", Icon: Circle }
  );
}

/** A quieter cousin of StatusBadge's tones, for cells in a dense grid. */
export const TONE_TINT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  ok: "bg-success/10 text-success dark:bg-success/15",
  warn: "bg-warning/10 text-warning dark:bg-warning/15",
  bad: "bg-destructive/10 text-destructive dark:bg-destructive/15",
  brand: "bg-primary/10 text-primary dark:bg-primary/20",
};

const OPEN_STAGE_STATUSES = new Set([
  "pending",
  "scheduled",
  "in_progress",
  "waiting_feedback",
  "rescheduled",
  "no_show",
]);

/** Where the candidate is: the first step still ahead of them. */
export function currentStage(stages: Stage[]): Stage | null {
  return stages.find((s) => s.kind !== "applied" && OPEN_STAGE_STATUSES.has(s.status)) ?? null;
}

/** The meeting a stage cell talks about: the next one booked, else the latest. */
export function stageMeeting(stage: Stage): Meeting | null {
  return (
    stage.meetings.find((m) => m.status === "scheduled") ??
    stage.meetings[stage.meetings.length - 1] ??
    null
  );
}

/**
 * The table's step columns, in pipeline order.
 *
 * Stage names are user-editable text, so applications can disagree about
 * them. Every name any row uses becomes a column, placed at the earliest
 * position it appears in.
 */
export function stageColumns(rows: { stages: Stage[] }[]): string[] {
  const position = new Map<string, number>();
  for (const row of rows) {
    for (const stage of row.stages) {
      const seen = position.get(stage.name);
      position.set(stage.name, seen === undefined ? stage.seq : Math.min(seen, stage.seq));
    }
  }
  return [...position.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}
