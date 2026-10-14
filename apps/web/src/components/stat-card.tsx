import type { ComponentType, ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tile } from "@/components/tile";

/** One headline number, its label, and an optional line of context beneath. */
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
  /** Accepted for older call sites; every stat now uses the accent wash. */
  tone?: "primary" | "success" | "warning" | "info";
}) {
  return (
    <Card className="gap-0 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm font-semibold">{label}</p>
        {Icon && <Tile icon={Icon} size="sm" />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-10 w-20" />
      ) : (
        <p className="mt-2 text-4xl font-medium tracking-tight tabular-nums">{value}</p>
      )}
      {hint && <p className="text-subtle mt-1 text-xs font-medium">{hint}</p>}
    </Card>
  );
}
