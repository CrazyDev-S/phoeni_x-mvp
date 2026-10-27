"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { activeFilters } from "@/components/freelancing/active-filters";
import {
  type FilterCatalogue,
  type FilterOption,
  type JobSearchParams,
} from "@/lib/freelancing";

const ANY = "__any__";

export const POSTED_WITHIN: [number, string][] = [
  [1, "Last hour"],
  [6, "Last 6 hours"],
  [24, "Last 24 hours"],
  [72, "Last 3 days"],
  [168, "Last week"],
  [720, "Last 30 days"],
];

function Pick({
  label,
  anyLabel,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  anyLabel: string;
  value: string | null;
  options: FilterOption[];
  onChange: (next: string | null) => void;
  className?: string;
}) {
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? null : v)}>
      <SelectTrigger size="sm" aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The search controls across the top of the results: the query, the sort and
 * page size, the filters used on nearly every search, and the button that opens
 * the rest in a sheet. A control the source cannot apply is not shown.
 */
export function JobToolbar({
  value,
  catalogue,
  searching,
  onChange,
  onSearch,
  onReset,
  onOpenFilters,
}: {
  value: JobSearchParams;
  catalogue: FilterCatalogue | undefined;
  searching: boolean;
  onChange: (next: JobSearchParams) => void;
  onSearch: () => void;
  onReset: () => void;
  onOpenFilters: () => void;
}) {
  const set = <K extends keyof JobSearchParams>(key: K, next: JobSearchParams[K]) =>
    onChange({ ...value, [key]: next, cursor: null });
  const supported = catalogue ? new Set(catalogue.source.filters) : null;
  const has = (key: keyof JobSearchParams) => !supported || supported.has(key);
  const source = catalogue?.source;
  // Filters in the sheet; the toolbar's own controls show their state themselves.
  const count = activeFilters(value, catalogue).length;

  // The search box speaks the source's language: Upwork's API takes a Lucene
  // expression, the Apify actors take keywords.
  const placeholder =
    source?.key === "upwork"
      ? "Search postings (Lucene syntax works)"
      : source && !source.filters.includes("and_terms")
        ? "Keywords, comma-separated; any matches"
        : "Search postings";

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <div className="relative min-w-56 flex-1 sm:max-w-md">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={value.query}
          onChange={(e) => set("query", e.target.value)}
          placeholder={placeholder}
          aria-label="Search"
          className="pl-8"
        />
      </div>

      <Select value={value.sort} onValueChange={(v) => set("sort", v as JobSearchParams["sort"])}>
        <SelectTrigger size="sm" aria-label="Sort" className="w-36">
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

      {has("posted_within_hours") && (
        <Select
          value={value.posted_within_hours ? String(value.posted_within_hours) : ANY}
          onValueChange={(v) => set("posted_within_hours", v === ANY ? null : Number(v))}
        >
          <SelectTrigger size="sm" aria-label="Posted within" className="w-32">
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

      {has("job_type") && (
        <Pick
          label="Job type"
          anyLabel="Any type"
          className="w-28"
          value={value.job_type}
          options={catalogue?.job_types ?? []}
          onChange={(v) => set("job_type", v as JobSearchParams["job_type"])}
        />
      )}

      {has("experience_level") && (
        <Pick
          label="Experience level"
          anyLabel="Any level"
          className="w-32"
          value={value.experience_level}
          options={catalogue?.experience_levels ?? []}
          onChange={(v) => set("experience_level", v)}
        />
      )}

      <Select value={String(value.page_size)} onValueChange={(v) => set("page_size", Number(v))}>
        <SelectTrigger size="sm" aria-label="Results per page" className="w-28">
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

      <Button type="button" variant="outline" size="sm" onClick={onOpenFilters}>
        <SlidersHorizontal />
        Filters
        {count > 0 && (
          <span className="bg-accent text-accent-foreground rounded px-1 text-[11px] font-semibold tabular-nums">
            {count}
          </span>
        )}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onReset}
        disabled={count === 0 && !value.query && !value.job_type && !value.experience_level && !value.posted_within_hours}
        aria-label="Reset filters"
      >
        <RotateCcw />
      </Button>

      <Button type="submit" variant="brand" size="sm" disabled={searching}>
        {searching ? <Spinner /> : <Search />}
        Search {source?.label ?? "jobs"}
      </Button>
    </form>
  );
}
