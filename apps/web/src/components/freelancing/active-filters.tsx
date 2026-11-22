"use client";

import { X } from "lucide-react";

import { PROPOSAL_CAPS } from "@/components/freelancing/job-filters";
import { EMPTY_FILTER, type JobFilter } from "@/lib/freelancing";

interface Active {
  key: string;
  label: string;
  /** What to put back to unset this one filter. */
  clear: Partial<JobFilter>;
}

const usd = (n: number) => `$${n.toLocaleString()}`;

/** The sheet's filters currently set, one removable chip each. The toolbar's own controls are not repeated. */
export function activeFilters(value: JobFilter): Active[] {
  const out: Active[] = [];
  const add = (key: keyof JobFilter, label: string, clear?: Partial<JobFilter>) =>
    out.push({ key, label, clear: clear ?? { [key]: EMPTY_FILTER[key] } });

  if (value.skills.length) add("skills", `Skills: ${value.skills.join(", ")}`);
  if (value.exclude_terms.length) add("exclude_terms", `Without: ${value.exclude_terms.join(", ")}`);
  if (value.hourly_rate_min != null) add("hourly_rate_min", `Hourly ${usd(value.hourly_rate_min)}+`);
  if (value.budget_min != null || value.budget_max != null) {
    const label =
      value.budget_min != null && value.budget_max != null
        ? `Fixed ${usd(value.budget_min)}-${usd(value.budget_max)}`
        : value.budget_min != null
          ? `Fixed ${usd(value.budget_min)}+`
          : `Fixed up to ${usd(value.budget_max as number)}`;
    add("budget_min", label, { budget_min: null, budget_max: null });
  }
  if (value.verified_payment_only) add("verified_payment_only", "Payment verified");
  if (value.client_min_spent != null) add("client_min_spent", `Client spent ${usd(value.client_min_spent)}+`);
  if (value.client_min_rating != null) add("client_min_rating", `Client ${value.client_min_rating}+ rating`);
  if (value.client_locations.length) add("client_locations", `From ${value.client_locations.join(", ")}`);
  if (value.exclude_client_locations.length) add("exclude_client_locations", `Not from ${value.exclude_client_locations.join(", ")}`);
  if (value.proposals_max != null) {
    const label = PROPOSAL_CAPS.find(([n]) => n === value.proposals_max)?.[1] ?? `${value.proposals_max} or fewer`;
    add("proposals_max", `${label} proposals`);
  }
  if (value.open_to_country) add("open_to_country", `Open to ${value.open_to_country}`);
  if (!value.hide_hidden) add("hide_hidden", "Showing hidden");
  return out;
}

export function ActiveFilters({ value, onChange }: { value: JobFilter; onChange: (next: JobFilter) => void }) {
  const items = activeFilters(value);
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
              onClick={() => onChange({ ...value, ...item.clear })}
            >
              <X className="size-3" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
