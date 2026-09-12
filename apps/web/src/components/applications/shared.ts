import type { Tone } from "@/components/status-badge";

export interface Stage {
  id: string;
  seq: number;
  name: string;
  kind: string;
  status: string;
  scheduled_for: string | null;
}

export interface ApplicationRow {
  id: string;
  company_name: string;
  role_title: string;
  job_url: string | null;
  location: string | null;
  status: string;
  stage_count: number;
  stages_passed: number;
  must_have_coverage_percent: number | null;
  current_stage: Stage | null;
  next_meeting: { id: string; starts_at: string; title: string } | null;
  created_at: string;
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
