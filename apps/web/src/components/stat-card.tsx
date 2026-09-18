import type { ComponentType, ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** One headline number, its label, and an optional line of context beneath. */
export function StatCard({
  label,
  value,
  hint,
  Icon,
  loading,
  tone = "primary",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  Icon: ComponentType<{ className?: string }>;
  loading?: boolean;
  tone?: "primary" | "success" | "warning" | "info";
}) {
  const tones = {
    primary: "bg-accent text-accent-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    info: "bg-info/10 text-info",
  }[tone];

  return (
    // Tighter below sm, where the cards sit two to a row on a phone.
    <Card className="gap-0 p-4 transition-shadow duration-200 hover:shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9",
            tones,
          )}
        >
          <Icon className="size-4 sm:size-4.5" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-20" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {value}
        </p>
      )}
      {hint && <p className="text-subtle mt-1 text-xs">{hint}</p>}
    </Card>
  );
}
