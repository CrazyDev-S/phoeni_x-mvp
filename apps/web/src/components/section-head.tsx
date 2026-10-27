import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A section's title, its count, and whatever filters or actions sit at the far end. */
export function SectionHead({
  title,
  count,
  children,
  className,
}: {
  title: ReactNode;
  count?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1.5", className)}>
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {count != null && (
        <span className="text-muted-foreground bg-muted rounded px-1.5 text-[11px] font-semibold tabular-nums">
          {count}
        </span>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}
