"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGE_LABEL, STAGES, type TrackStage } from "@/lib/freelancing";
import { cn } from "@/lib/utils";

/** The stage, as a select rather than a drag target: works on a phone and from the keyboard. */
export function StageSelect({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: TrackStage;
  onChange: (next: TrackStage) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TrackStage)} disabled={disabled}>
      <SelectTrigger className={cn("h-8 w-full text-xs", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGES.map((stage) => (
          <SelectItem key={stage} value={stage}>
            {STAGE_LABEL[stage]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
