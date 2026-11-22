"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { activeFilters } from "@/components/freelancing/active-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPTY_FILTER,
  EXPERIENCE_LEVELS,
  isFiltered,
  JOB_TYPES,
  SORTS,
  type JobFilter,
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

function Pick<T extends string | number>({
  label,
  anyLabel,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  anyLabel?: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (next: T | null) => void;
  className?: string;
}) {
  return (
    <Select
      value={value == null ? ANY : String(value)}
      onValueChange={(v) => onChange(v === ANY ? null : (options.find((o) => String(o.value) === v)?.value ?? null))}
    >
      <SelectTrigger size="sm" aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {anyLabel && <SelectItem value={ANY}>{anyLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The controls across the top of the shared list. The list answers as you
 * type - it is our own database, not a search to run - so there is no button.
 */
export function JobToolbar({
  value,
  onChange,
  onOpenFilters,
}: {
  value: JobFilter;
  onChange: (next: JobFilter) => void;
  onOpenFilters: () => void;
}) {
  const set = <K extends keyof JobFilter>(key: K, next: JobFilter[K]) => onChange({ ...value, [key]: next });
  const count = activeFilters(value).length;
  const dirty = isFiltered(value) || value.sort !== EMPTY_FILTER.sort;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1 sm:max-w-md">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          type="search"
          value={value.query}
          onChange={(e) => set("query", e.target.value)}
          placeholder="Filter by title, description or skill"
          aria-label="Filter jobs"
          className="pl-8"
        />
      </div>

      <Pick label="Sort" className="w-36" value={value.sort} options={SORTS} onChange={(v) => set("sort", v ?? "recency")} />
      <Pick
        label="Posted within"
        anyLabel="Any time"
        className="w-32"
        value={value.posted_within_hours}
        options={POSTED_WITHIN.map(([hours, label]) => ({ value: hours, label }))}
        onChange={(v) => set("posted_within_hours", v)}
      />
      <Pick label="Job type" anyLabel="Any type" className="w-28" value={value.job_type} options={JOB_TYPES} onChange={(v) => set("job_type", v)} />
      <Pick
        label="Experience level"
        anyLabel="Any level"
        className="w-32"
        value={value.experience_level}
        options={EXPERIENCE_LEVELS}
        onChange={(v) => set("experience_level", v)}
      />

      <Button type="button" variant="outline" size="sm" onClick={onOpenFilters}>
        <SlidersHorizontal />
        Filters
        {count > 0 && (
          <span className="bg-accent text-accent-foreground rounded px-1 text-[11px] font-semibold tabular-nums">{count}</span>
        )}
      </Button>

      <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(EMPTY_FILTER)} disabled={!dirty} aria-label="Reset filters">
        <RotateCcw />
      </Button>
    </div>
  );
}
