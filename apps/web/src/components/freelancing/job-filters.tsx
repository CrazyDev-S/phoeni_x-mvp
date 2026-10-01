"use client";

import { ChevronDown, RotateCcw, Search } from "lucide-react";
import { useState, type ReactNode } from "react";

import { TagInput } from "@/components/freelancing/tag-input";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  activeFilterCount,
  EMPTY_SEARCH,
  type FilterCatalogue,
  type FilterOption,
  type JobSearchParams,
} from "@/lib/freelancing";
import { cn } from "@/lib/utils";

const ANY = "__any__";

const RATINGS: [number, string][] = [
  [3.5, "3.5 and up"],
  [4, "4.0 and up"],
  [4.5, "4.5 and up"],
  [4.8, "4.8 and up"],
];

const ENGLISH_LEVELS: [NonNullable<JobSearchParams["english_level"]>, string][] = [
  ["basic", "Basic"],
  ["conversational", "Conversational"],
  ["fluent", "Fluent"],
  ["native", "Native or bilingual"],
];

const POSTED_WITHIN: [number, string][] = [
  [1, "Last hour"],
  [6, "Last 6 hours"],
  [24, "Last 24 hours"],
  [72, "Last 3 days"],
  [168, "Last week"],
  [720, "Last 30 days"],
];

/** A labelled group of controls that folds away, so the panel stays scannable. */
function Group({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b pb-3 last:border-b-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 py-2 text-left text-sm font-semibold"
        >
          <span className="flex-1">{title}</span>
          {count ? (
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs tabular-nums">
              {count}
            </span>
          ) : null}
          <ChevronDown className={cn("text-subtle size-4 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function OptionSelect({
  label,
  value,
  options,
  onChange,
  anyLabel = "Any",
}: {
  label: string;
  value: string | null;
  options: FilterOption[];
  onChange: (next: string | null) => void;
  anyLabel?: string;
}) {
  return (
    <FormField label={label}>
      {(control) => (
        <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? null : v)}>
          <SelectTrigger {...control} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{anyLabel}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
                {o.hint ? <span className="text-subtle ml-1 text-xs">{o.hint}</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}

function RangeFields({
  label,
  low,
  high,
  onChange,
  prefix,
}: {
  label: string;
  low: number | null;
  high: number | null;
  onChange: (low: number | null, high: number | null) => void;
  prefix?: string;
}) {
  const parse = (raw: string) => (raw.trim() === "" ? null : Math.max(0, Math.floor(Number(raw))));
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          {prefix && <span className="text-subtle pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs">{prefix}</span>}
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Min"
            aria-label={`${label} minimum`}
            value={low ?? ""}
            onChange={(e) => onChange(parse(e.target.value), high)}
            className={cn(prefix && "pl-6")}
          />
        </div>
        <div className="relative">
          {prefix && <span className="text-subtle pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs">{prefix}</span>}
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Max"
            aria-label={`${label} maximum`}
            value={high ?? ""}
            onChange={(e) => onChange(low, parse(e.target.value))}
            className={cn(prefix && "pl-6")}
          />
        </div>
      </div>
    </div>
  );
}

/** Three-state: unset, on, off. Upwork treats "off" differently from "not sent". */
function TriSwitch({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked ? true : null)}
        aria-label={label}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-subtle text-xs">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * The full search form: every parameter the job source accepts.
 *
 * The free-text query and the sort sit at the top because they change on
 * every search; everything else folds into groups so the panel reads as a
 * checklist rather than a wall of inputs. A control the source in service
 * cannot apply is not rendered: a filter that silently did nothing would be
 * worse than none.
 */
export function JobFilters({
  value,
  catalogue,
  searching,
  onChange,
  onSearch,
  onReset,
}: {
  value: JobSearchParams;
  catalogue: FilterCatalogue | undefined;
  searching: boolean;
  onChange: (next: JobSearchParams) => void;
  onSearch: () => void;
  onReset: () => void;
}) {
  const set = <K extends keyof JobSearchParams>(key: K, next: JobSearchParams[K]) =>
    onChange({ ...value, [key]: next, cursor: null });

  // Until the catalogue answers, every control is offered.
  const supported = catalogue ? new Set(catalogue.source.filters) : null;
  const has = (...keys: (keyof JobSearchParams)[]) => !supported || keys.some((k) => supported.has(k));
  const source = catalogue?.source;

  const toggleIn = (key: "durations" | "category_ids" | "subcategory_ids", item: string) => {
    const list = value[key];
    set(key, list.includes(item) ? list.filter((v) => v !== item) : [...list, item]);
  };

  const categories = catalogue?.categories ?? [];
  const textCount = [value.title, value.skills.length, value.and_terms.length, value.or_terms.length,
    value.exact_terms.length, value.exclude_terms.length].filter(Boolean).length;
  const taxonomyCount = [value.category_ids.length, value.subcategory_ids.length, value.occupation_ids.length,
    value.ontology_skill_ids.length].filter(Boolean).length;
  const contractCount = [value.job_type, value.workload, value.durations.length, value.experience_level,
    value.budget_min ?? value.budget_max, value.hourly_rate_min ?? value.hourly_rate_max].filter((v) => v !== null && v !== 0 && v !== "").length;
  const clientCount = [value.client_hires_min ?? value.client_hires_max, value.proposals_min ?? value.proposals_max,
    value.verified_payment_only, value.previous_clients_only, value.client_locations.length, value.client_timezone,
    value.enterprise_only, value.phone_verified_only, value.client_min_rating, value.client_min_hire_rate,
    value.client_min_spent ?? value.client_max_spent, value.exclude_client_locations.length,
  ].filter((v) => v !== null && v !== 0 && v !== "").length;
  const applyCount = [value.connects_min ?? value.connects_max, value.english_level, value.contractor_type,
    value.featured_only, value.exclude_with_questions].filter((v) => v !== null && v !== 0).length;
  // The search box speaks the source's language: Upwork's API takes a Lucene
  // expression, the Apify actors take keywords.
  const queryPlaceholder =
    source?.key === "upwork"
      ? "Search postings — Lucene syntax works"
      : source && !source.filters.includes("and_terms")
        ? "Keywords, comma-separated — any of them matches"
        : "Search postings";

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <div className="relative">
        <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={value.query}
          onChange={(e) => set("query", e.target.value)}
          placeholder={queryPlaceholder}
          className="h-11 pl-9"
          aria-label="Search"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select value={value.sort} onValueChange={(v) => set("sort", v as JobSearchParams["sort"])}>
          <SelectTrigger className="w-full" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(catalogue?.sorts ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(value.page_size)} onValueChange={(v) => set("page_size", Number(v))}>
          <SelectTrigger className="w-full" aria-label="Results per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(catalogue?.page_sizes ?? [20]).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="brand" className="h-10 flex-1" disabled={searching}>
          {searching ? <Spinner /> : <Search />}
          Search {source?.label ?? "jobs"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={onReset}
          disabled={activeFilterCount(value) === 0 && !value.query}
          aria-label="Reset filters"
        >
          <RotateCcw />
        </Button>
      </div>

      <div className="space-y-0">
        {has("title", "skills", "and_terms", "or_terms", "exact_terms", "exclude_terms") && (
        <Group title="Text" count={textCount} defaultOpen>
          {has("title") && (
          <FormField label="Words in the title">
            {(control) => (
              <Input {...control} value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. FastAPI" />
            )}
          </FormField>
          )}
          {has("skills") && (
          <FormField
            label="Skills"
            hint={
              source?.key === "upwork"
                ? "Upwork skill slugs, any of them. Enter or comma to add."
                : "Skill names as Upwork shows them, any of them. Enter or comma to add."
            }
          >
            {(control) => (
              <TagInput {...control} value={value.skills} onChange={(v) => set("skills", v)} placeholder="python, fastapi" />
            )}
          </FormField>
          )}
          {has("and_terms", "or_terms", "exact_terms", "exclude_terms") && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="xs" className="text-muted-foreground -ml-2">
                Advanced terms
                <ChevronDown className="size-3" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <p className="text-subtle text-xs">
                Used only when the search box above is empty; Upwork ignores these next to a query.
              </p>
              <FormField label="All of these words">
                {(control) => <TagInput {...control} value={value.and_terms} onChange={(v) => set("and_terms", v)} />}
              </FormField>
              <FormField label="Any of these words">
                {(control) => <TagInput {...control} value={value.or_terms} onChange={(v) => set("or_terms", v)} />}
              </FormField>
              <FormField label="Exact phrases">
                {(control) => <TagInput {...control} value={value.exact_terms} onChange={(v) => set("exact_terms", v)} />}
              </FormField>
              <FormField label="None of these words">
                {(control) => <TagInput {...control} value={value.exclude_terms} onChange={(v) => set("exclude_terms", v)} />}
              </FormField>
            </CollapsibleContent>
          </Collapsible>
          )}
        </Group>
        )}

        {has("posted_within_hours") && (
        <Group title="Posted" count={value.posted_within_hours ? 1 : 0} defaultOpen>
          <FormField label="Posted within" hint="Fresh postings get fewer proposals.">
            {(control) => (
              <Select
                value={value.posted_within_hours ? String(value.posted_within_hours) : ANY}
                onValueChange={(v) => set("posted_within_hours", v === ANY ? null : Number(v))}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any time</SelectItem>
                  {POSTED_WITHIN.map(([hours, label]) => (
                    <SelectItem key={hours} value={String(hours)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </Group>
        )}

        {has("category_ids", "subcategory_ids", "occupation_ids", "ontology_skill_ids") && (
        <Group title="Category" count={taxonomyCount}>
          {!has("category_ids") ? null : catalogue?.categories_error ? (
            <p className="text-subtle text-xs">{catalogue.categories_error}</p>
          ) : categories.length === 0 ? (
            <p className="text-subtle text-xs">Categories load from {source?.label ?? "the job source"} once connected.</p>
          ) : (
            <ScrollArea className="h-64 rounded-lg border">
              <ul className="space-y-1 p-2">
                {categories.map((category) => {
                  const on = value.category_ids.includes(category.id);
                  return (
                    <li key={category.id}>
                      <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
                        <Checkbox checked={on} onCheckedChange={() => toggleIn("category_ids", category.id)} />
                        <span className="min-w-0 flex-1 truncate">{category.label}</span>
                      </label>
                      {on && category.subcategories.length > 0 && (
                        <ul className="ml-6 space-y-0.5">
                          {category.subcategories.map((sub) => (
                            <li key={sub.value}>
                              <label className="text-muted-foreground flex items-center gap-2 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted/60">
                                <Checkbox
                                  checked={value.subcategory_ids.includes(sub.value)}
                                  onCheckedChange={() => toggleIn("subcategory_ids", sub.value)}
                                />
                                <span className="min-w-0 flex-1 truncate">{sub.label}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
          {has("occupation_ids") && (
          <FormField label="Occupation IDs" hint="Ontology occupation UIDs, any of them.">
            {(control) => <TagInput {...control} value={value.occupation_ids} onChange={(v) => set("occupation_ids", v)} />}
          </FormField>
          )}
          {has("ontology_skill_ids") && (
          <FormField label="Ontology skill IDs" hint="All of them must match.">
            {(control) => <TagInput {...control} value={value.ontology_skill_ids} onChange={(v) => set("ontology_skill_ids", v)} />}
          </FormField>
          )}
        </Group>
        )}

        {has("job_type", "workload", "experience_level", "durations", "budget_min", "hourly_rate_min") && (
        <Group title="Contract" count={contractCount}>
          {has("job_type") && (
          <OptionSelect
            label="Job type"
            value={value.job_type}
            options={catalogue?.job_types ?? []}
            onChange={(v) => set("job_type", v as JobSearchParams["job_type"])}
          />
          )}
          {has("workload") && (
          <OptionSelect
            label="Workload"
            value={value.workload}
            options={catalogue?.workloads ?? []}
            onChange={(v) => set("workload", v)}
          />
          )}
          {has("experience_level") && (
          <OptionSelect
            label="Experience level"
            value={value.experience_level}
            options={catalogue?.experience_levels ?? []}
            onChange={(v) => set("experience_level", v)}
          />
          )}
          {has("durations") && (
          <div className="space-y-1.5">
            <Label className="text-sm">Duration</Label>
            <ul className="space-y-1">
              {(catalogue?.durations ?? []).map((o) => (
                <li key={o.value}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={value.durations.includes(o.value)}
                      onCheckedChange={() => toggleIn("durations", o.value)}
                    />
                    {o.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          )}
          {has("budget_min") && (
          <RangeFields
            label="Fixed budget"
            prefix="$"
            low={value.budget_min}
            high={value.budget_max}
            onChange={(lo, hi) => onChange({ ...value, budget_min: lo, budget_max: hi, cursor: null })}
          />
          )}
          {has("hourly_rate_min") && (
          <RangeFields
            label="Hourly rate"
            prefix="$"
            low={value.hourly_rate_min}
            high={value.hourly_rate_max}
            onChange={(lo, hi) => onChange({ ...value, hourly_rate_min: lo, hourly_rate_max: hi, cursor: null })}
          />
          )}
        </Group>
        )}

        {has("verified_payment_only", "previous_clients_only", "enterprise_only", "client_hires_min", "proposals_min", "client_locations", "client_timezone", "client_min_rating", "client_min_spent", "client_min_hire_rate", "phone_verified_only", "exclude_client_locations") && (
        <Group title="Client" count={clientCount}>
          {has("verified_payment_only") && (
          <TriSwitch
            label="Payment verified only"
            value={value.verified_payment_only}
            onChange={(v) => set("verified_payment_only", v)}
          />
          )}
          {has("previous_clients_only") && (
          <TriSwitch
            label="Previous clients only"
            hint="Clients you have worked with before."
            value={value.previous_clients_only}
            onChange={(v) => set("previous_clients_only", v)}
          />
          )}
          {has("phone_verified_only") && (
          <TriSwitch
            label="Phone verified only"
            value={value.phone_verified_only}
            onChange={(v) => set("phone_verified_only", v)}
          />
          )}
          {has("enterprise_only") && (
          <TriSwitch
            label="Enterprise clients only"
            value={value.enterprise_only}
            onChange={(v) => set("enterprise_only", v)}
          />
          )}
          {has("client_min_rating") && (
          <FormField label="Client rating">
            {(control) => (
              <Select
                value={value.client_min_rating == null ? ANY : String(value.client_min_rating)}
                onValueChange={(v) => set("client_min_rating", v === ANY ? null : Number(v))}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any rating</SelectItem>
                  {RATINGS.map(([rating, label]) => (
                    <SelectItem key={rating} value={String(rating)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          )}
          {has("client_min_spent") && (
          <RangeFields
            label="Client total spent"
            prefix="$"
            low={value.client_min_spent}
            high={value.client_max_spent}
            onChange={(lo, hi) => onChange({ ...value, client_min_spent: lo, client_max_spent: hi, cursor: null })}
          />
          )}
          {has("client_min_hire_rate") && (
          <FormField label="Client hire rate at least (%)" hint="Share of their postings that ended in a hire.">
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                placeholder="50"
                value={value.client_min_hire_rate ?? ""}
                onChange={(e) =>
                  set(
                    "client_min_hire_rate",
                    e.target.value.trim() === "" ? null : Math.min(100, Math.max(0, Math.floor(Number(e.target.value)))),
                  )
                }
              />
            )}
          </FormField>
          )}
          {has("client_hires_min") && (
          <RangeFields
            label="Client hires"
            low={value.client_hires_min}
            high={value.client_hires_max}
            onChange={(lo, hi) => onChange({ ...value, client_hires_min: lo, client_hires_max: hi, cursor: null })}
          />
          )}
          {has("proposals_min") && (
          <RangeFields
            label="Proposals received"
            low={value.proposals_min}
            high={value.proposals_max}
            onChange={(lo, hi) => onChange({ ...value, proposals_min: lo, proposals_max: hi, cursor: null })}
          />
          )}
          {has("client_locations") && (
          <FormField
            label="Client location"
            hint={source?.key === "apify" ? "Region, subregion or country, e.g. Europe, Northern America, Germany." : "Country or city."}
          >
            {(control) => <TagInput {...control} value={value.client_locations} onChange={(v) => set("client_locations", v)} placeholder="Germany, New York" />}
          </FormField>
          )}
          {has("exclude_client_locations") && (
          <FormField label="Not from these client locations" hint="Region, subregion or country.">
            {(control) => (
              <TagInput
                {...control}
                value={value.exclude_client_locations}
                onChange={(v) => set("exclude_client_locations", v)}
                placeholder="Pakistan, Southern Asia"
              />
            )}
          </FormField>
          )}
          {has("client_timezone") && (
          <FormField label="Client timezone">
            {(control) => (
              <Input {...control} value={value.client_timezone} onChange={(e) => set("client_timezone", e.target.value)} placeholder="Europe/Berlin" />
            )}
          </FormField>
          )}
        </Group>
        )}

        {has("connects_min", "english_level", "contractor_type", "featured_only", "exclude_with_questions") && (
        <Group title="Applying" count={applyCount}>
          {has("connects_min") && (
          <RangeFields
            label="Connects to apply"
            low={value.connects_min}
            high={value.connects_max}
            onChange={(lo, hi) => onChange({ ...value, connects_min: lo, connects_max: hi, cursor: null })}
          />
          )}
          {has("english_level") && (
          <FormField label="English asked for">
            {(control) => (
              <Select
                value={value.english_level ?? ANY}
                onValueChange={(v) => set("english_level", v === ANY ? null : (v as JobSearchParams["english_level"]))}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any level</SelectItem>
                  {ENGLISH_LEVELS.map(([level, label]) => (
                    <SelectItem key={level} value={level}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          )}
          {has("contractor_type") && (
          <FormField label="Open to">
            {(control) => (
              <Select
                value={value.contractor_type ?? ANY}
                onValueChange={(v) => set("contractor_type", v === ANY ? null : (v as JobSearchParams["contractor_type"]))}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Freelancers and agencies</SelectItem>
                  <SelectItem value="freelancer">Freelancers only</SelectItem>
                  <SelectItem value="agency">Agencies only</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
          )}
          {has("featured_only") && (
          <TriSwitch
            label="Featured postings only"
            hint="Clients paid to promote them."
            value={value.featured_only}
            onChange={(v) => set("featured_only", v)}
          />
          )}
          {has("exclude_with_questions") && (
          <TriSwitch
            label="Skip postings with screening questions"
            value={value.exclude_with_questions}
            onChange={(v) => set("exclude_with_questions", v)}
          />
          )}
        </Group>
        )}

        {has("user_location_match", "visitor_country", "area", "talent_cloud_only", "talent_cloud_ids") && (
        <Group title="Location & talent clouds" count={[value.user_location_match, value.visitor_country, value.area, value.talent_cloud_only, value.talent_cloud_ids.length].filter((v) => v !== null && v !== "" && v !== 0).length}>
          {has("user_location_match") && (
          <TriSwitch
            label="Match my location"
            hint="Only postings open to freelancers where you are."
            value={value.user_location_match}
            onChange={(v) => set("user_location_match", v)}
          />
          )}
          {has("visitor_country") && (
          <FormField label="Visitor country" hint="Two-letter code.">
            {(control) => (
              <Input {...control} maxLength={2} value={value.visitor_country} onChange={(e) => set("visitor_country", e.target.value.toUpperCase())} placeholder="US" className="w-24 uppercase" />
            )}
          </FormField>
          )}
          {has("area") && (
          <div className="space-y-1.5">
            <Label className="text-sm">Within an area</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["latitude", "longitude", "radius_miles"] as const).map((key) => (
                <Input
                  key={key}
                  type="number"
                  step="any"
                  aria-label={key.replace("_", " ")}
                  placeholder={key === "radius_miles" ? "Miles" : key === "latitude" ? "Lat" : "Lng"}
                  value={value.area?.[key] ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = { latitude: 0, longitude: 0, radius_miles: 50, ...(value.area ?? {}) };
                    if (raw.trim() === "" && key !== "radius_miles") {
                      set("area", null);
                      return;
                    }
                    next[key] = Number(raw);
                    set("area", next);
                  }}
                />
              ))}
            </div>
          </div>
          )}
          {has("talent_cloud_only") && (
          <TriSwitch
            label="Talent cloud postings only"
            value={value.talent_cloud_only}
            onChange={(v) => set("talent_cloud_only", v)}
          />
          )}
          {has("talent_cloud_ids") && (
          <FormField label="Talent cloud IDs">
            {(control) => <TagInput {...control} value={value.talent_cloud_ids} onChange={(v) => set("talent_cloud_ids", v)} />}
          </FormField>
          )}
        </Group>
        )}

        <Group title="On this side">
          <TriSwitch
            label="Hide jobs I hid"
            value={value.hide_hidden ? true : null}
            onChange={(v) => set("hide_hidden", v === true)}
          />
          <TriSwitch
            label="Hide jobs I already applied to"
            value={value.hide_applied ? true : null}
            onChange={(v) => set("hide_applied", v === true)}
          />
          <FormField
            label="Open to applicants from"
            hint="Drops postings that only accept freelancers from other countries."
          >
            {(control) => (
              <Input
                {...control}
                value={value.open_to_country}
                placeholder="Thailand"
                onChange={(e) => set("open_to_country", e.target.value)}
              />
            )}
          </FormField>
        </Group>
      </div>

      {source && (
        <p className="text-subtle text-xs">
          Source: <span className="text-muted-foreground font-medium">{source.label}</span>
          {supported ? ` · ${supported.size} filters offered` : ""}
        </p>
      )}
    </form>
  );
}

export { EMPTY_SEARCH };
