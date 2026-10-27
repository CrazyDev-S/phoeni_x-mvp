"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUSES } from "./shared";

/** Outcomes read at a glance in the table; the rest stay a plain bordered select. */
const OUTCOME: Record<string, string> = {
  offer: "bg-success/15 text-success border-transparent",
  hired: "bg-success/15 text-success border-transparent",
  rejected: "bg-destructive/12 text-destructive border-transparent",
  ghosted: "bg-warning/18 text-warning border-transparent",
  withdrawn: "bg-soft-2 text-secondary-foreground/80 border-transparent",
};

/**
 * The application's status.
 *
 * "pill" is the 28px control in a table row or card; "field" is the 32px one
 * for a detail view.
 */
export function StatusSelect({
  value,
  onChange,
  disabled,
  appearance = "pill",
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  appearance?: "pill" | "field";
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size={appearance === "pill" ? "sm" : "default"}
        aria-label={label}
        className={cn("w-full font-medium", appearance === "pill" && OUTCOME[value])}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {STATUS_LABEL[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
