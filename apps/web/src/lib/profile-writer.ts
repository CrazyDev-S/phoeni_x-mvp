/**
 * The profile writer's versions (backend: app/freelancing/profile_writer.py).
 *
 * Drafts count toward the next save: 1.1, 1.2, ... then Save records 1, and
 * the drafts after it are 2.1, 2.2, ...
 */

export interface TitleOption {
  text: string;
  keyword: string;
  intent: string;
  tier_signal: "premium" | "mid" | "growth" | "";
}

export interface WorkEntry {
  company: string;
  location: string;
  role: string;
  duration: string;
  employment_type: string;
  story: string;
}

export interface EducationEntry {
  school: string;
  degree: string;
  duration: string;
  field: string;
}

export interface PortfolioPiece {
  name: string;
  doubt: string;
  build: string;
  signal: string;
}

export interface CertStep {
  cert: string;
  issuer: string;
  time: string;
  why: string;
}

export interface StackBrief {
  stack: string;
  domain: string;
  rate_tier: "A" | "B" | "C" | "";
  posture: string;
  certs_verified: string[];
  cert_proxies: string[];
  keywords_t1: string[];
  keywords_t2: string[];
  keywords_t3: string[];
  client_fears: string[];
  differentiators: string[];
  tenure_rules: string[];
  portfolio_signal: string[];
}

/** The whole written profile. A save made without the writer holds only the form's fields. */
export interface ProfileDocument {
  title: string | null;
  summary: string | null;
  skills: string[];
  hourly_rate: number | null;
  titles?: TitleOption[];
  title_rationale?: string;
  work_history?: WorkEntry[];
  education?: EducationEntry[];
  portfolio_direction?: PortfolioPiece[];
  cert_roadmap?: CertStep[];
  brief?: StackBrief;
  questions?: string[];
  change_note?: string;
}

export interface ProfileVersion {
  id: string;
  profile_id: string | null;
  major: number;
  minor: number;
  instruction: string | null;
  document: ProfileDocument;
  based_on_id: string | null;
  generation_id: string | null;
  created_at: string;
}

export interface ProfileVersions {
  items: ProfileVersion[];
  running_generation_id: string | null;
}

export const versionLabel = (v: Pick<ProfileVersion, "major" | "minor">) =>
  v.minor ? `${v.major}.${v.minor}` : String(v.major);

export const isSaved = (v: Pick<ProfileVersion, "minor">) => v.minor === 0;

/** Under the "freelancing" key, so a profile save refreshes it too. */
export const versionsKey = (profileId: string | null) =>
  ["freelancing", "profile-versions", profileId ?? "new"] as const;

export const versionsPath = (profileId: string | null) =>
  `/api/v1/freelancing/profile-versions${profileId ? `?profile_id=${profileId}` : ""}`;

/** Whether a version holds the writer's sections, not only the form's fields. */
export function hasWriting(doc: ProfileDocument): boolean {
  return Boolean(
    doc.titles?.length ||
      doc.work_history?.length ||
      doc.education?.length ||
      doc.portfolio_direction?.length ||
      doc.cert_roadmap?.length ||
      doc.brief?.stack,
  );
}
