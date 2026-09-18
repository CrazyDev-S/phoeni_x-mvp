export interface FormOption { label: string; value: string }

export type FieldType =
  | "text" | "email" | "tel" | "url" | "number" | "date" | "textarea"
  | "select" | "radio" | "checkbox" | "combobox" | "richtext" | "file" | "unknown";

export interface ScannedField {
  id: string;
  type: FieldType;
  label: string;
  help: string;
  name: string;
  autocomplete: string;
  required: boolean;
  max_length: number | null;
  current_value: string;
  options: FormOption[];
  options_unknown: boolean;
  group: string;
  /** A file input's accept attribute, so a PDF-only upload is not sent a .docx. */
  accept: string;
}

/** What a frame reports about itself. It cannot know its own frame id. */
export interface FrameScan {
  frameKey: string;
  url: string;
  fields: ScannedField[];
  /** iframes the top frame can SEE, so we can detect ones we could not inject into. */
  iframeCount: number;
  iframeSrcs: string[];
  closedShadowRoots: number;
}

export interface ScanResult extends FrameScan {
  /** Chrome's id for the frame, which filling uses to reach the same frame again. */
  frameId: number;
}

export interface JobExtract {
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  description_text: string;
  json_ld: Record<string, unknown> | null;
  ats: string | null;
}

/** "unconfirmed": a file was attached, but the page gave no sign it took it. */
export type FillStatus = "filled" | "fuzzy" | "reverted" | "failed" | "manual" | "unconfirmed";

export interface FillResult {
  id: string;
  status: FillStatus;
  label: string;
  intended: string;
  observed: string | null;
  reason?: string;
  optionsSeen?: string[];
}

export interface FileUpload {
  name: string;
  mime: string;
  base64: string;
}

/** One field to fill, as the page scripts receive it. */
export interface FillStep {
  id: string;
  type: FieldType;
  answer?: string;
  checked?: boolean | null;
  label?: string;
  file?: FileUpload;
}

export type ResumeKind = "base" | "tailored";

export interface ResumeRef {
  kind: ResumeKind;
  id: string;
}

export interface LinkedResume extends ResumeRef {
  display_name: string;
  status: string;
  company_name: string | null;
  job_title: string | null;
  must_have_coverage_percent: number | null;
  base_resume_id: string | null;
  /** Set once a tailored resume is saved with an application. */
  application_id?: string | null;
}

export type GenerationStatus =
  | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needs_review";

export interface LinkGeneration {
  id: string;
  status: GenerationStatus;
  phase: string | null;
  progress_percent: number;
  error_detail: string | null;
}

/** What one tab's posting has on the backend: a resume, a run, or neither. */
export interface JobLink {
  url: string;
  job_key: string;
  linked: boolean;
  company_name: string | null;
  job_title: string | null;
  base_resume_id: string | null;
  resume: LinkedResume | null;
  generation: LinkGeneration | null;
}

export interface ResumeFacts {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
  headline: string | null;
  current_title: string | null;
  current_company: string | null;
  years_experience: number | null;
  work_preference: string | null;
  availability: string | null;
  summary: string | null;
  skills: { label: string; value: string }[];
  education: string[];
  languages: string[];
}

export type AnswerSource = "resume" | "profile" | "model" | "";

export interface FormAnswer {
  id: string;
  type: FieldType;
  label: string;
  answer: string;
  checked?: boolean | null;
  needs_user_input: boolean;
  reason: string;
  matched_fuzzily: boolean;
  source: AnswerSource;
}

export interface AutofillResponse {
  answers: FormAnswer[];
  unanswered: FormAnswer[];
  complete: boolean;
  cached: boolean;
  resume: LinkedResume | null;
  facts: ResumeFacts | null;
}
