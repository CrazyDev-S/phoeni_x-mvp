"use client";

import { X } from "lucide-react";

import {
  EMPTY_SEARCH,
  humanizeEnum,
  type FilterCatalogue,
  type JobSearchParams,
} from "@/lib/freelancing";

interface Active {
  key: string;
  label: string;
  /** What to put back to unset this one filter. */
  clear: Partial<JobSearchParams>;
}

function range(label: string, low: number | null, high: number | null, prefix = "") {
  const fmt = (n: number) => `${prefix}${n.toLocaleString()}`;
  if (low != null && high != null) return `${label} ${fmt(low)}-${fmt(high)}`;
  if (low != null) return `${label} ${fmt(low)}+`;
  return `${label} up to ${fmt(high as number)}`;
}

/** The filters currently set, one removable chip each. The toolbar's own controls are not repeated here. */
export function activeFilters(value: JobSearchParams, catalogue: FilterCatalogue | undefined): Active[] {
  const out: Active[] = [];
  const add = (key: keyof JobSearchParams, label: string, clear?: Partial<JobSearchParams>) =>
    out.push({ key, label, clear: clear ?? { [key]: EMPTY_SEARCH[key] } });
  const list = (key: keyof JobSearchParams, label: string) => {
    const items = value[key] as string[];
    if (items.length) add(key, `${label}: ${items.join(", ")}`);
  };
  const flag = (key: keyof JobSearchParams, label: string) => {
    if (value[key]) add(key, label);
  };
  const categoryLabel = (id: string) => catalogue?.categories.find((c) => c.id === id)?.label ?? id;

  if (value.title) add("title", `Title: ${value.title}`);
  list("skills", "Skills");
  list("and_terms", "All of");
  list("or_terms", "Any of");
  list("exact_terms", "Phrases");
  list("exclude_terms", "Without");
  if (value.category_ids.length) add("category_ids", value.category_ids.map(categoryLabel).join(", "), { category_ids: [], subcategory_ids: [] });
  if (value.subcategory_ids.length && !value.category_ids.length) add("subcategory_ids", `${value.subcategory_ids.length} subcategories`);
  list("occupation_ids", "Occupations");
  list("ontology_skill_ids", "Ontology skills");
  if (value.workload) add("workload", humanizeEnum(value.workload));
  if (value.durations.length) {
    const labels = value.durations.map((d) => catalogue?.durations.find((o) => o.value === d)?.label ?? d);
    add("durations", labels.join(", "));
  }
  if (value.budget_min != null || value.budget_max != null) {
    add("budget_min", range("Fixed", value.budget_min, value.budget_max, "$"), { budget_min: null, budget_max: null });
  }
  if (value.hourly_rate_min != null || value.hourly_rate_max != null) {
    add("hourly_rate_min", range("Hourly", value.hourly_rate_min, value.hourly_rate_max, "$"), { hourly_rate_min: null, hourly_rate_max: null });
  }
  flag("verified_payment_only", "Payment verified");
  flag("previous_clients_only", "Previous clients");
  flag("phone_verified_only", "Phone verified");
  flag("enterprise_only", "Enterprise");
  if (value.client_min_rating != null) add("client_min_rating", `Client ${value.client_min_rating}+ rating`);
  if (value.client_min_spent != null || value.client_max_spent != null) {
    add("client_min_spent", range("Client spent", value.client_min_spent, value.client_max_spent, "$"), { client_min_spent: null, client_max_spent: null });
  }
  if (value.client_min_hire_rate != null) add("client_min_hire_rate", `Hire rate ${value.client_min_hire_rate}%+`);
  if (value.client_hires_min != null || value.client_hires_max != null) {
    add("client_hires_min", range("Client hires", value.client_hires_min, value.client_hires_max), { client_hires_min: null, client_hires_max: null });
  }
  if (value.proposals_min != null || value.proposals_max != null) {
    add("proposals_min", range("Proposals", value.proposals_min, value.proposals_max), { proposals_min: null, proposals_max: null });
  }
  list("client_locations", "From");
  list("exclude_client_locations", "Not from");
  if (value.client_timezone) add("client_timezone", `Timezone ${value.client_timezone}`);
  if (value.connects_min != null || value.connects_max != null) {
    add("connects_min", range("Connects", value.connects_min, value.connects_max), { connects_min: null, connects_max: null });
  }
  if (value.english_level) add("english_level", `English: ${humanizeEnum(value.english_level)}`);
  if (value.contractor_type) add("contractor_type", value.contractor_type === "agency" ? "Agencies only" : "Freelancers only");
  flag("featured_only", "Featured");
  flag("exclude_with_questions", "No screening questions");
  flag("user_location_match", "Matches my location");
  if (value.visitor_country) add("visitor_country", `Visitor ${value.visitor_country}`);
  if (value.area) add("area", `Within ${value.area.radius_miles} mi`);
  flag("talent_cloud_only", "Talent cloud");
  list("talent_cloud_ids", "Talent clouds");
  if (value.open_to_country) add("open_to_country", `Open to ${value.open_to_country}`);
  return out;
}

export function ActiveFilters({
  value,
  catalogue,
  onChange,
}: {
  value: JobSearchParams;
  catalogue: FilterCatalogue | undefined;
  onChange: (next: JobSearchParams) => void;
}) {
  const items = activeFilters(value, catalogue);
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {items.map((item) => (
        <li key={item.key}>
          <span className="bg-accent text-accent-foreground inline-flex h-6 max-w-72 items-center gap-1 rounded-md pr-1 pl-2 text-xs font-medium">
            <span className="truncate">{item.label}</span>
            <button
              type="button"
              aria-label={`Remove filter ${item.label}`}
              className="hover:bg-foreground/10 grid size-4 shrink-0 place-items-center rounded"
              onClick={() => onChange({ ...value, ...item.clear, cursor: null })}
            >
              <X className="size-3" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
