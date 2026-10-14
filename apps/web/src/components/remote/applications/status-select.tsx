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

/** Outcomes read at a glance in the table; the rest stay an outlined pill. */
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
 * "pill" is the compact control in a table row or card; "field" is the
 * full-size, soft-filled one for a detail view. `raised` fills the pill white
 * for use on the accent row.
 */
export function StatusSelect({
  value,
  onChange,
  disabled,
  appearance = "pill",
  raised = false,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  appearance?: "pill" | "field";
  raised?: boolean;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size={appearance === "pill" ? "sm" : "default"}
        aria-label={label}
        className={cn(
          "w-full rounded-full",
          appearance === "pill"
            ? cn(
                "data-[size=sm]:h-[34px] data-[size=sm]:rounded-full data-[size=sm]:pr-2.5 data-[size=sm]:pl-3.5 border-[1.4px] text-[13px] font-semibold",
                raised
                  ? "bg-card border-transparent"
                  : (OUTCOME[value] ?? "border-foreground/20 hover:bg-foreground/5 bg-transparent"),
              )
            : "data-[size=default]:h-[46px] pr-4 pl-5 text-[0.9063rem]",
        )}
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
