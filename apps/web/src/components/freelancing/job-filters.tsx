"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { useState, type ReactNode } from "react";

import { FilterTags } from "@/components/freelancing/filter-tags";
import { FormField } from "@/components/form-field";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { JobFilter } from "@/lib/freelancing";
import { cn } from "@/lib/utils";

const ANY = "__any__";

export const RATINGS: [number, string][] = [
  [4, "4.0 and up"],
  [4.5, "4.5 and up"],
  [4.8, "4.8 and up"],
];

export const PROPOSAL_CAPS: [number, string][] = [
  [4, "Fewer than 5"],
  [10, "10 or fewer"],
  [15, "15 or fewer"],
  [20, "20 or fewer"],
  [50, "50 or fewer"],
];

/** The sheet's fields: a small label over a 32px control. */
function PanelField(props: ComponentProps<typeof FormField>) {
  return (
    <FormField
      {...props}
      className="gap-1 *:data-[slot=field-label]:text-xs *:data-[slot=field-label]:font-medium"
    />
  );
}

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
  const [open, setOpen] = useState(defaultOpen || Boolean(count));
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t first:border-t-0">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex h-9 w-full items-center gap-2 text-left text-[13px] font-semibold">
          <span className="flex-1">{title}</span>
          {count ? (
            <span className="bg-accent text-accent-foreground grid h-4 min-w-4 place-items-center rounded px-1 text-[11px] font-semibold tabular-nums">
              {count}
            </span>
          ) : null}
          <ChevronDown className={cn("text-subtle size-4 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2.5 pt-0.5 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

const parseAmount = (raw: string) => (raw.trim() === "" ? null : Math.max(0, Math.floor(Number(raw))));

function MoneyInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  onChange: (next: number | null) => void;
}) {
  return (
    <div className="relative">
      <span className="text-subtle pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px]">$</span>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={label}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(parseAmount(e.target.value))}
        className="pl-6!"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[13px] leading-snug">
      <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label={label} />
      {label}
    </label>
  );
}

function CapSelect({
  label,
  value,
  options,
  anyLabel,
  onChange,
}: {
  label: string;
  value: number | null;
  options: [number, string][];
  anyLabel: string;
  onChange: (next: number | null) => void;
}) {
  return (
    <PanelField label={label}>
      {(control) => (
        <Select value={value == null ? ANY : String(value)} onValueChange={(v) => onChange(v === ANY ? null : Number(v))}>
          <SelectTrigger {...control} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{anyLabel}</SelectItem>
            {options.map(([n, text]) => (
              <SelectItem key={n} value={String(n)}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </PanelField>
  );
}

/**
 * The filters that do not fit the toolbar, folded into groups. Every one is
 * answered from the shared list, so none can silently do nothing.
 */
export function JobFilters({ value, onChange }: { value: JobFilter; onChange: (next: JobFilter) => void }) {
  const set = <K extends keyof JobFilter>(key: K, next: JobFilter[K]) => onChange({ ...value, [key]: next });
  const count = (...values: unknown[]) =>
    values.filter((v) => v !== null && v !== false && v !== "" && !(Array.isArray(v) && !v.length)).length;

  return (
    <div>
      <Group title="Skills & words" count={count(value.skills, value.exclude_terms)} defaultOpen>
        <PanelField label="Any of these skills">
          {(control) => <FilterTags {...control} value={value.skills} onChange={(v) => set("skills", v)} placeholder="Python, FastAPI" />}
        </PanelField>
        <PanelField label="None of these words">
          {(control) => <FilterTags {...control} value={value.exclude_terms} onChange={(v) => set("exclude_terms", v)} placeholder="WordPress, unpaid" />}
        </PanelField>
      </Group>

      <Group title="Pay" count={count(value.hourly_rate_min, value.budget_min ?? value.budget_max)}>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Hourly jobs paying at least</Label>
          <MoneyInput label="Minimum hourly rate" value={value.hourly_rate_min} placeholder="40" onChange={(v) => set("hourly_rate_min", v)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Fixed-price budget</Label>
          <div className="grid grid-cols-2 gap-2">
            <MoneyInput label="Minimum budget" value={value.budget_min} placeholder="Min" onChange={(v) => set("budget_min", v)} />
            <MoneyInput label="Maximum budget" value={value.budget_max} placeholder="Max" onChange={(v) => set("budget_max", v)} />
          </div>
        </div>
      </Group>

      <Group
        title="Client"
        count={count(value.verified_payment_only, value.client_min_spent, value.client_min_rating, value.client_locations, value.exclude_client_locations)}
      >
        <Toggle label="Payment verified only" checked={value.verified_payment_only} onChange={(v) => set("verified_payment_only", v)} />
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Has spent at least</Label>
          <MoneyInput label="Minimum client spend" value={value.client_min_spent} placeholder="1000" onChange={(v) => set("client_min_spent", v)} />
        </div>
        <CapSelect label="Rating" value={value.client_min_rating} options={RATINGS} anyLabel="Any rating" onChange={(v) => set("client_min_rating", v)} />
        <PanelField label="Based in">
          {(control) => <FilterTags {...control} value={value.client_locations} onChange={(v) => set("client_locations", v)} placeholder="United States, DE" />}
        </PanelField>
        <PanelField label="Not based in">
          {(control) => (
            <FilterTags {...control} value={value.exclude_client_locations} onChange={(v) => set("exclude_client_locations", v)} placeholder="India" />
          )}
        </PanelField>
      </Group>

      <Group title="Competition" count={count(value.proposals_max)}>
        <CapSelect label="Proposals so far" value={value.proposals_max} options={PROPOSAL_CAPS} anyLabel="Any number" onChange={(v) => set("proposals_max", v)} />
      </Group>

      <Group title="Just for you" count={count(value.open_to_country, !value.hide_hidden)}>
        <Toggle label="Hide jobs I hid" checked={value.hide_hidden} onChange={(v) => set("hide_hidden", v)} />
        <PanelField label="Open to applicants from">
          {(control) => (
            <Input {...control} value={value.open_to_country} placeholder="Thailand" onChange={(e) => set("open_to_country", e.target.value)} />
          )}
        </PanelField>
      </Group>
    </div>
  );
}
