/**
 * The Freelancing category's shapes, labels and small helpers.
 *
 * Types mirror `backend/app/schemas/freelancing.py`. Labels live here, once,
 * so a stage reads the same on the board, in the table and in the calendar.
 */
import type { QueryClient } from "@tanstack/react-query";

import type { Tone } from "@/components/status-badge";

// --- The shared job list ---------------------------------------------------------------

export type JobType = "hourly" | "fixed";
export type ExperienceLevel = "entry_level" | "intermediate" | "expert";
export type SortField = "recency" | "captured";

/**
 * What the job view asks of the shared list. Mirrors `JobFilter` on the
 * backend; every filter is answered from captured postings.
 */
export interface JobFilter {
  query: string;
  skills: string[];
  exclude_terms: string[];
  job_type: JobType | null;
  experience_level: ExperienceLevel | null;
  /** Hourly postings paying at least this; fixed-price ones are left alone. */
  hourly_rate_min: number | null;
  /** Fixed-price budget range; hourly ones are left alone. */
  budget_min: number | null;
  budget_max: number | null;
  posted_within_hours: number | null;
  verified_payment_only: boolean;
  client_min_spent: number | null;
  client_min_rating: number | null;
  client_locations: string[];
  exclude_client_locations: string[];
  proposals_max: number | null;
  /** Drop postings that only accept applicants from other countries. */
  open_to_country: string;
  hide_hidden: boolean;
  sort: SortField;
}

export const EMPTY_FILTER: JobFilter = {
  query: "",
  skills: [],
  exclude_terms: [],
  job_type: null,
  experience_level: null,
  hourly_rate_min: null,
  budget_min: null,
  budget_max: null,
  posted_within_hours: null,
  verified_payment_only: false,
  client_min_spent: null,
  client_min_rating: null,
  client_locations: [],
  exclude_client_locations: [],
  proposals_max: null,
  open_to_country: "",
  hide_hidden: true,
  sort: "recency",
};

export const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "fixed", label: "Fixed price" },
];

export const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: "entry_level", label: "Entry level" },
  { value: "intermediate", label: "Intermediate" },
  { value: "expert", label: "Expert" },
];

export const SORTS: { value: SortField; label: string }[] = [
  { value: "recency", label: "Newest posted" },
  { value: "captured", label: "Newest added" },
];

/** The request body: blanks dropped, so the backend sees only what was set. */
export function toFilterBody(filter: JobFilter): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
    body[key] = typeof value === "string" ? value.trim() : value;
  }
  return body;
}

/** Whether anything narrows the list beyond the defaults. The sort does not. */
export function isFiltered(filter: JobFilter): boolean {
  return (Object.keys(EMPTY_FILTER) as (keyof JobFilter)[]).some(
    (key) => key !== "sort" && JSON.stringify(filter[key]) !== JSON.stringify(EMPTY_FILTER[key]),
  );
}

/** Saved parameters back onto the full shape, so every control has a value. */
export function fromSavedParams(saved: Record<string, unknown>): JobFilter {
  return { ...EMPTY_FILTER, ...(saved as Partial<JobFilter>) };
}

export interface SavedSearch {
  id: string;
  name: string;
  params: Record<string, unknown>;
  last_run_at: string | null;
  created_at: string;
}

// --- Jobs ---------------------------------------------------------------------------

export type TrackStage =
  | "focused"
  | "proposal_drafted"
  | "submitted"
  | "viewed"
  | "interviewing"
  | "hired"
  | "declined"
  | "withdrawn"
  | "closed";

export interface JobClient {
  company_name?: string | null;
  hire_rate_percent?: number | null;
  avg_hourly_rate?: number | null;
  industry?: string | null;
  company_size?: string | null;
  phone_verified?: boolean | null;
  country?: string | null;
  city?: string | null;
  payment_verified?: boolean | null;
  total_spent?: number | null;
  total_spent_display?: string | null;
  total_hires?: number | null;
  total_posted_jobs?: number | null;
  total_reviews?: number | null;
  feedback?: number | null;
  member_since?: string | null;
}

/** One Upwork posting in the shared list, with this user's own marks on it. */
export interface JobCard {
  id: string;
  upwork_id: string;
  url: string | null;
  title: string;
  description: string | null;
  job_type: JobType | null;
  budget_amount: number | null;
  budget_currency: string | null;
  hourly_min: number | null;
  hourly_max: number | null;
  duration_label: string | null;
  workload: string | null;
  experience_level: string | null;
  category: string | null;
  subcategory: string | null;
  skills: string[];
  client: JobClient;
  total_applicants: number | null;
  freelancers_to_hire: number | null;
  preferred_freelancer_location: string[];
  published_at: string | null;
  /** When the posting entered the shared list, and when anyone last saw it. */
  created_at: string;
  last_seen_at: string;
  focused_at: string | null;
  hidden_at: string | null;
  track_stage: TrackStage | null;
  proposal_count: number;
  /** As Upwork words it: "10 to 15". */
  proposals_label: string | null;
  connects_required: number | null;
  /** Live, from whoever's extension is watching the posting's client. */
  client_activity_at: string | null;
  interviewing: number | null;
  watchers: JobWatcher[];
}

/** Someone whose extension has the posting open right now. */
export interface JobWatcher {
  name: string;
  you: boolean;
  /** Their extension checks the client and alerts them. */
  notify: boolean;
  /** Theirs is the watch whose findings go to the whole team. */
  relay: boolean;
}

/** What a watched posting's client did, as the relaying watch told the team. */
export interface TeamAlert {
  id: number;
  kind: "client_viewed" | "interview_started";
  job_id: string;
  title: string;
  url: string | null;
  relay_name: string | null;
  /** This user's own watch alerted them already. */
  local: boolean;
  client_activity_at: string | null;
  interviewing: number | null;
  previous_interviewing: number | null;
  occurred_at: string;
}

export interface TeamAlertFeed {
  items: TeamAlert[];
  cursor: number;
}

/** A client seen this recently is on the posting now. */
export const CLIENT_HERE_MS = 5 * 60_000;

export function clientIsHere(iso: string | null | undefined): boolean {
  return Boolean(iso) && Date.now() - Date.parse(iso!) <= CLIENT_HERE_MS;
}

export function alertHeadline(alert: TeamAlert): string {
  return alert.kind === "client_viewed"
    ? "Client is viewing"
    : `Client started interviewing (${alert.previous_interviewing ?? "?"} → ${alert.interviewing ?? "?"})`;
}

export interface JobActivity {
  last_client_activity: string | null;
  invites_sent: number | null;
  total_invited_to_interview: number | null;
  total_hired: number | null;
  total_unanswered_invites: number | null;
}

export interface JobDetail extends JobCard {
  /** Null until someone opened the posting's own page with the extension on. */
  detail_captured_at: string | null;
  screening_questions: string[];
  activity: Partial<JobActivity>;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// --- Profile, proposals, tracking -----------------------------------------------------

export interface PortfolioItem {
  title: string;
  url: string | null;
  summary: string | null;
}

export interface SpecializedProfile {
  name: string;
  title: string | null;
  overview: string | null;
}

export interface FreelancerProfile {
  id: string;
  name: string;
  is_default: boolean;
  title: string | null;
  overview: string | null;
  hourly_rate: number | null;
  skills: string[];
  portfolio: PortfolioItem[];
  specialized_profiles: SpecializedProfile[];
  upwork_profile_url: string | null;
  raw_profile_markdown: string | null;
  /** The latest saved version's number (lib/profile-writer.ts); null until first saved. */
  version: number | null;
  created_at: string;
  updated_at: string;
}

export type ProposalStatus = "draft" | "ready" | "submitted" | "archived";

export interface JobBrief {
  id: string;
  title: string;
  url: string | null;
  job_type: JobType | null;
  budget_amount: number | null;
  hourly_min: number | null;
  hourly_max: number | null;
  client_country: string | null;
  total_applicants: number | null;
  published_at: string | null;
  focused_at: string | null;
  description: string | null;
  skills: string[];
}

export interface ProposalAnswer {
  question: string;
  answer: string;
}

export interface Proposal {
  id: string;
  job_id: string;
  profile_id: string | null;
  status: ProposalStatus;
  bid_type: JobType | null;
  bid_amount: number | null;
  bid_currency: string | null;
  connects_estimate: number | null;
  cover_letter_markdown: string;
  answers: ProposalAnswer[];
  engine_version: string | null;
  generation_id: string | null;
  generation_meta: Record<string, unknown>;
  submitted_at: string | null;
  /** The writer's version the letter was last set from. */
  version_id: string | null;
  created_at: string;
  updated_at: string;
  job: JobBrief | null;
}

export interface TrackMeeting {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  conferencing_url: string | null;
}

export interface Track {
  id: string;
  job_id: string;
  proposal_id: string | null;
  stage: TrackStage;
  submitted_at: string | null;
  bid_type: JobType | null;
  bid_amount: number | null;
  connects_spent: number | null;
  client_replied_at: string | null;
  next_action_at: string | null;
  notes_markdown: string | null;
  outcome_notes: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  job: JobBrief;
  proposal: {
    id: string;
    status: ProposalStatus;
    bid_type: JobType | null;
    bid_amount: number | null;
    submitted_at: string | null;
  } | null;
  next_meeting: TrackMeeting | null;
}

export interface TrackEvent {
  id: number;
  from_stage: TrackStage | null;
  to_stage: TrackStage;
  reason: string | null;
  actor: string;
  occurred_at: string;
}

export interface TrackDetail extends Track {
  events: TrackEvent[];
  meetings: TrackMeeting[];
}

export interface TrackSummary {
  focused: number;
  proposal_drafted: number;
  submitted: number;
  viewed: number;
  interviewing: number;
  hired: number;
  declined: number;
  withdrawn: number;
  closed: number;
  total: number;
}

/** The pipeline, in the order a bid moves through it. */
export const STAGES: TrackStage[] = [
  "focused",
  "proposal_drafted",
  "submitted",
  "viewed",
  "interviewing",
  "hired",
  "declined",
  "withdrawn",
  "closed",
];

export const CLOSED_STAGES = new Set<TrackStage>(["hired", "declined", "withdrawn", "closed"]);

export const STAGE_LABEL: Record<TrackStage, string> = {
  focused: "Focused",
  proposal_drafted: "Draft written",
  submitted: "Submitted",
  viewed: "Viewed by client",
  interviewing: "Interviewing",
  hired: "Hired",
  declined: "Declined",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

export const STAGE_TONE: Record<TrackStage, Tone> = {
  focused: "neutral",
  proposal_drafted: "neutral",
  submitted: "brand",
  viewed: "brand",
  interviewing: "brand",
  hired: "ok",
  declined: "bad",
  withdrawn: "neutral",
  closed: "neutral",
};

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ready: { label: "Ready to send", tone: "warn" },
  submitted: { label: "Submitted", tone: "ok" },
  archived: { label: "Archived", tone: "neutral" },
};

// --- helpers ----------------------------------------------------------------------------

/** "$40–$70/hr", "$1,500 fixed", or "Budget not set". */
export function formatBudget(job: {
  job_type: JobType | null;
  budget_amount: number | null;
  budget_currency?: string | null;
  hourly_min: number | null;
  hourly_max: number | null;
}): string {
  const currency = job.budget_currency ?? "USD";
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 ? 2 : 0,
    }).format(value);
  if (job.job_type === "hourly" || job.hourly_min != null || job.hourly_max != null) {
    if (job.hourly_min != null && job.hourly_max != null && job.hourly_min !== job.hourly_max) {
      return `${money(job.hourly_min)}–${money(job.hourly_max)}/hr`;
    }
    const rate = job.hourly_max ?? job.hourly_min;
    return rate != null ? `${money(rate)}/hr` : "Hourly, rate not set";
  }
  if (job.job_type === "fixed") {
    return job.budget_amount != null ? `${money(job.budget_amount)} fixed` : "Fixed, budget not set";
  }
  return "Budget not set";
}

/** "3h ago", "2d ago" - how long since a posting went up. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** "EXPERT" -> "Expert", "FULL_TIME" -> "Full time". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "";
  const text = value.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every query that shows a job, a proposal or a track. One write refreshes all of them. */
const FREELANCING_QUERIES = ["freelancing"];

export function invalidateFreelancing(queryClient: QueryClient) {
  for (const key of FREELANCING_QUERIES) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/** "template-v0" -> a sentence about where the draft came from. */
export function describeEngine(version: string | null): string {
  if (!version || version === "pending") return "Not drafted yet";
  if (version === "manual") return "Written by hand";
  const edited = version.endsWith("+edited");
  const base = version.replace("+edited", "");
  const source = base.startsWith("template")
    ? "Template draft"
    : base.startsWith("prompt")
      ? "Proposal writer"
      : base;
  return edited ? `${source}, edited by hand` : source;
}
