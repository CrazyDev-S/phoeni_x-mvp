import type { ComponentType, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

/** One headline number and its label: a compact cell, ruled rather than boxed. */
export function StatCard({
  label,
  value,
  hint,
  Icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  Icon?: ComponentType<{ className?: string }>;
  loading?: boolean;
  /** Accepted for older call sites. */
  tone?: "primary" | "success" | "warning" | "info";
}) {
  return (
    <div className="bg-card min-w-0 rounded-lg border px-3 py-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {Icon && <Icon className="size-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-12" />
      ) : (
        <p className="mt-0.5 text-xl leading-tight font-semibold tabular-nums">{value}</p>
      )}
      {hint && <p className="text-subtle truncate text-[11px]">{hint}</p>}
    </div>
  );
}
