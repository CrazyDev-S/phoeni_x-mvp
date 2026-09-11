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
}

export interface ScanResult {
  frameKey: string;
  url: string;
  fields: ScannedField[];
  /** iframes the top frame can SEE, so we can detect ones we could not inject into. */
  iframeCount: number;
  iframeSrcs: string[];
  closedShadowRoots: number;
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

export type FillStatus = "filled" | "fuzzy" | "reverted" | "failed" | "manual";

export interface FillResult {
  id: string;
  status: FillStatus;
  label: string;
  intended: string;
  observed: string | null;
  reason?: string;
  optionsSeen?: string[];
}
