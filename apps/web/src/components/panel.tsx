import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one container: a bordered white panel. Tables and lists sit edge to edge
 * inside it (no padding); give it `p-3` for form-like content.
 */
export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("bg-card min-w-0 rounded-lg border", className)} {...props} />;
}

/** A panel's title bar: title and count at the left, controls at the right. */
export function PanelHead({
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
    <div className={cn("flex min-h-9 items-center gap-2 border-b px-3 py-1", className)}>
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {count != null && (
        <span className="text-muted-foreground text-[11px] font-semibold tabular-nums">{count}</span>
      )}
      {children && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
    </div>
  );
}

/** The row of controls above a table: search, filters, view switch. */
export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}

/** A row of stat cells that fills the width evenly. */
export function StatStrip({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]", className)}
      {...props}
    />
  );
}
