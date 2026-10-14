import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A section's title, an underlined count, and whatever filters or actions sit at the far end. */
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
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-3", className)}>
      <h2 className="text-2xl font-medium tracking-tight">{title}</h2>
      {count != null && (
        <span className="text-muted-foreground border-foreground border-b-[1.5px] pb-px text-[13px] font-semibold">
          {count}
        </span>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
