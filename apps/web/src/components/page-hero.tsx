import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface HeadStat {
  value: ReactNode;
  label: string;
}

/**
 * The top of every page: one line.
 *
 * An optional back arrow, the title, the page's headline counts inline beside
 * it, and whatever acts on the whole page at the far end. `description` is kept
 * for older call sites and rendered as one muted line beside the title; new
 * pages leave it out.
 */
export function PageHero({
  title,
  description,
  stats,
  actions,
  back,
  badge,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Headline counts, shown inline after the title. */
  stats?: HeadStat[];
  actions?: ReactNode;
  /** A route to go back to; renders a small back button. */
  back?: string;
  /** A small badge after the title, for a state like "Coming soon". */
  badge?: ReactNode;
  className?: string;
  /** Accepted for older call sites. */
  size?: "display" | "page";
  eyebrow?: string;
  eyebrowIcon?: ComponentType<{ className?: string }>;
}) {
  return (
    <header className={cn("flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="hover:bg-muted focus-visible:ring-ring/40 -ml-1 grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
        >
          <ArrowLeft className="size-4" />
        </Link>
      )}
      <h1 className="page-title min-w-0 truncate">{title}</h1>
      {badge}
      {stats && stats.length > 0 && (
        <dl className="text-muted-foreground flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          {stats.map(({ value, label }) => (
            <div key={label} className="flex items-baseline gap-1">
              <dd className="text-foreground order-first text-[13px] font-semibold tabular-nums">{value}</dd>
              <dt>{label}</dt>
            </div>
          ))}
        </dl>
      )}
      {description && <p className="text-muted-foreground min-w-0 truncate text-xs">{description}</p>}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
