import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The top of every page.
 *
 * One shape - eyebrow, display heading, one line of orientation, and whatever
 * acts on the whole page - so moving between sections never feels like moving
 * between products.
 */
export function PageHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  description,
  actions,
  size = "display",
  className,
}: {
  eyebrow?: string;
  eyebrowIcon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** "page" for a record's own name, which is content rather than a headline. */
  size?: "display" | "page";
  className?: string;
}) {
  return (
    <header
      className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}
    >
      <div className="max-w-2xl">
        {eyebrow && (
          <span className="border-primary/20 bg-accent text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
            {EyebrowIcon && <EyebrowIcon className="size-3.5" />}
            {eyebrow}
          </span>
        )}
        <h1
          className={cn(
            "font-semibold tracking-tight text-balance",
            size === "display" ? "text-3xl md:text-display" : "text-2xl md:text-3xl",
            eyebrow && "mt-4",
          )}
        >
          {title}
        </h1>
        {description && (
          <p
            className={cn(
              "text-muted-foreground text-pretty",
              size === "display" ? "mt-3 text-base" : "mt-2 text-sm",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
