/**
 * The Freelancing category's shapes, labels and small helpers.
 *
 * Types mirror `backend/app/schemas/freelancing.py`. Labels live here, once,
 * so a stage reads the same on the board, in the table and in the calendar.
 */
import type { QueryClient } from "@tanstack/react-query";

import type { Tone } from "@/components/status-badge";

// --- Upwork connection ----------------------------------------------------------

export type ConnectionStatus =
  | "not_configured"
  | "pending_authorization"
  | "connected"
  | "expired"
  | "error";

export interface UpworkConnection {
  status: ConnectionStatus;
  configured: boolean;
  credentials_source: "user" | "environment" | "none";
  client_id: string | null;
  masked_client_secret: string | null;
  connected: boolean;
  upwork_user_name: string | null;
  upwork_user_id: string | null;
  tenant_id: string | null;
  redirect_uri: string;
  access_token_expires_at: string | null;
  connected_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
}

export const CONNECTION_LABEL: Record<ConnectionStatus, { label: string; tone: Tone }> = {
  not_configured: { label: "Not configured", tone: "neutral" },
  pending_authorization: { label: "Awaiting authorization", tone: "warn" },
  connected: { label: "Connected", tone: "ok" },
  expired: { label: "Session expired", tone: "warn" },
  error: { label: "Error", tone: "bad" },
};

// --- Search -----------------------------------------------------------------------

export type JobType = "hourly" | "fixed";
export type SortField = "recency" | "relevance" | "client_total_charge" | "client_rating";

export interface AreaParam {
  latitude: number;
  longitude: number;
  radius_miles: number;
}

/** Every parameter the search accepts. Mirrors `JobSearchParams` on the backend. */
export interface JobSearchParams {
  query: string;
  title: string;
  skills: string[];
  and_terms: string[];
  or_terms: string[];
  exact_terms: string[];
  exclude_terms: string[];
  category_ids: string[];
  subcategory_ids: string[];
  occupation_ids: string[];
  ontology_skill_ids: string[];
  job_type: JobType | null;
  workload: string | null;
  durations: string[];
  experience_level: string | null;
  budget_min: number | null;
  budget_max: number | null;
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
  client_hires_min: number | null;
  client_hires_max: number | null;
  proposals_min: number | null;
  proposals_max: number | null;
  verified_payment_only: boolean | null;
  previous_clients_only: boolean | null;
  client_locations: string[];
  client_timezone: string;
  enterprise_only: boolean | null;
  talent_cloud_only: boolean | null;
  talent_cloud_ids: string[];
  user_location_match: boolean | null;
  visitor_country: string;
  area: AreaParam | null;
  /** Only postings published within this many hours. Not every source can. */
  posted_within_hours: number | null;
  client_min_rating: number | null;
  client_min_spent: number | null;
  client_max_spent: number | null;
  client_min_hire_rate: number | null;
  phone_verified_only: boolean | null;
  exclude_client_locations: string[];
  connects_min: number | null;
  connects_max: number | null;
  english_level: "basic" | "conversational" | "fluent" | "native" | null;
  contractor_type: "freelancer" | "agency" | null;
  featured_only: boolean | null;
  exclude_with_questions: boolean | null;
  sort: SortField;
  page_size: number;
  cursor: string | null;
  hide_hidden: boolean;
  hide_applied: boolean;
  /** Drop postings that only accept applicants from other countries. Applied here. */
  open_to_country: string;
}

export const EMPTY_SEARCH: JobSearchParams = {
  query: "",
  title: "",
  skills: [],
  and_terms: [],
  or_terms: [],
  exact_terms: [],
  exclude_terms: [],
  category_ids: [],
  subcategory_ids: [],
  occupation_ids: [],
  ontology_skill_ids: [],
  job_type: null,
  workload: null,
  durations: [],
  experience_level: null,
  budget_min: null,
  budget_max: null,
  hourly_rate_min: null,
  hourly_rate_max: null,
  client_hires_min: null,
  client_hires_max: null,
  proposals_min: null,
  proposals_max: null,
  verified_payment_only: null,
  previous_clients_only: null,
  client_locations: [],
  client_timezone: "",
  enterprise_only: null,
  talent_cloud_only: null,
  talent_cloud_ids: [],
  user_location_match: null,
  visitor_country: "",
  area: null,
  posted_within_hours: null,
  client_min_rating: null,
  client_min_spent: null,
  client_max_spent: null,
  client_min_hire_rate: null,
  phone_verified_only: null,
  exclude_client_locations: [],
  connects_min: null,
  connects_max: null,
  english_level: null,
  contractor_type: null,
  featured_only: null,
  exclude_with_questions: null,
  sort: "recency",
  page_size: 20,
  cursor: null,
  hide_hidden: true,
  hide_applied: false,
  open_to_country: "",
};

/** The request body: blanks dropped, so the backend sees only what was set. */
export function toSearchBody(params: JobSearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
    body[key] = typeof value === "string" ? value.trim() : value;
  }
  return body;
}

/** Saved parameters back onto the full shape, so every control has a value. */
export function fromSavedParams(saved: Record<string, unknown>): JobSearchParams {
  return { ...EMPTY_SEARCH, ...(saved as Partial<JobSearchParams>), cursor: null };
}

/** How many controls are set beyond the free-text query, for the filter badge. */
export function activeFilterCount(params: JobSearchParams): number {
  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    if (["query", "sort", "page_size", "cursor", "hide_hidden", "hide_applied"].includes(key)) continue;
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
    count += 1;
  }
  return count;
}

export interface FilterOption {
  value: string;
  label: string;
  hint?: string | null;
}

export interface CategoryOption {
  id: string;
  label: string;
  subcategories: FilterOption[];
}

/** Which provider answers searches, and which controls it honours. */
export interface JobSourceInfo {
  key: string;
  label: string;
  filters: string[];
  sorts: string[];
  detail: boolean;
  categories: boolean;
  skills: boolean;
}

/** The source in service, and whether this user can search with it now. */
export interface JobSourceStatus extends JobSourceInfo {
  ready: boolean;
  setup_hint: string | null;
}

export interface ApifyConnection {
  configured: boolean;
  token_source: "user" | "environment" | "none";
  masked_token: string | null;
  status: "unverified" | "valid" | "invalid" | "revoked";
  apify_username: string | null;
  actor_id: string;
  actor_label: string | null;
  cost_note: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  last_run_id: string | null;
  last_run_at: string | null;
}

export interface FilterCatalogue {
  source: JobSourceInfo;
  job_types: FilterOption[];
  workloads: FilterOption[];
  durations: FilterOption[];
  experience_levels: FilterOption[];
  sorts: FilterOption[];
  page_sizes: number[];
  categories: CategoryOption[];
  categories_error: string | null;
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
  company_name: string | null;
  /** A first name the source inferred with confidence. */
  contact_name?: string | null;
  hire_rate_percent?: number | null;
  avg_hourly_rate?: number | null;
  industry?: string | null;
  phone_verified?: boolean | null;
  country: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  payment_verified: boolean | null;
  verification_status: string | null;
  total_spent: number | null;
  total_spent_display: string | null;
  total_hires: number | null;
  total_posted_jobs: number | null;
  total_reviews: number | null;
  feedback: number | null;
  last_contract_platform: string | null;
  has_financial_privacy: boolean | null;
}

export interface JobCard {
  id: string;
  upwork_id: string;
  ciphertext: string | null;
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
  is_premium: boolean;
  is_enterprise: boolean;
  preferred_freelancer_location: string[];
  published_at: string | null;
  renewed_at: string | null;
  last_seen_at: string;
  focused_at: string | null;
  hidden_at: string | null;
  applied: boolean;
  track_stage: TrackStage | null;
  proposal_count: number;
  /** From the source's own record, when it has them. */
  connects_required: number | null;
  featured: boolean;
  job_score: number | null;
}

export interface JobActivity {
  last_client_activity: string | null;
  invites_sent: number | null;
  total_invited_to_interview: number | null;
  total_hired: number | null;
  total_unanswered_invites: number | null;
  total_offered: number | null;
  average_bid: number | null;
  min_bid: number | null;
  max_bid: number | null;
  average_interviewed_bid: number | null;
  /** Whether the client already hired someone for this posting. */
  client_has_hired: boolean | null;
}

export interface JobDetail extends JobCard {
  detail_fetched_at: string | null;
  screening_questions: string[];
  cover_letter_required: boolean | null;
  activity: Partial<JobActivity>;
  qualification: Record<string, unknown>;
  location_preference: Record<string, unknown>;
  attachments: { id?: string; fileName?: string; fileSize?: number; link?: string }[];
  on_site_type: string | null;
  status: string | null;
}

export interface JobSearchPage {
  items: JobCard[];
  total: number | null;
  has_next_page: boolean;
  end_cursor: string | null;
  hidden_count: number;
  /** The source is still working (an Apify run): ask again with `end_cursor`. */
  pending: boolean;
  progress_note: string | null;
  /** Something the source said about this search. */
  notice: string | null;
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

export function clientSummary(client: JobClient): string {
  const parts: string[] = [];
  if (client.country) parts.push(client.city ? `${client.city}, ${client.country}` : client.country);
  if (client.total_spent_display) parts.push(`${client.total_spent_display} spent`);
  else if (client.total_spent != null) parts.push(`$${Math.round(client.total_spent).toLocaleString()} spent`);
  if (client.total_hires != null) parts.push(`${client.total_hires} hires`);
  if (client.hire_rate_percent != null) parts.push(`${Math.round(client.hire_rate_percent)}% hire rate`);
  if (client.feedback != null && client.feedback > 0) {
    parts.push(`${client.feedback.toFixed(1)}★${client.total_reviews ? ` (${client.total_reviews})` : ""}`);
  }
  return parts.join(" · ");
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
      ? "Generated from your profile"
      : base;
  return edited ? `${source}, edited by hand` : source;
}
