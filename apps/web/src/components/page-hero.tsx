import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface HeadStat {
  value: ReactNode;
  label: string;
}

/** The accent disc sits behind the first letter, so only plain-text titles get it. */
function accentFirst(title: ReactNode) {
  if (typeof title !== "string" || !title) return title;
  return (
    <>
      <span className="title-o">{title[0]}</span>
      {title.slice(1)}
    </>
  );
}

/**
 * The top of every page.
 *
 * One shape: an optional round back button, an uppercase title with an accent
 * disc behind its first letter, the page's headline numbers inline beside it,
 * and whatever acts on the whole page at the far end. A line of orientation
 * sits underneath when the page needs one.
 */
export function PageHero({
  title,
  description,
  stats,
  actions,
  back,
  badge,
  size = "display",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Headline numbers, shown big beside the title. */
  stats?: HeadStat[];
  actions?: ReactNode;
  /** A route to go back to; renders a round back button. */
  back?: string;
  /** A small pill after the title, for a state like "Coming soon". */
  badge?: ReactNode;
  /** "page" for a record's own name, which is content rather than a headline. */
  size?: "display" | "page";
  className?: string;
  /** Accepted for older call sites; the new header has no eyebrow. */
  eyebrow?: string;
  eyebrowIcon?: ComponentType<{ className?: string }>;
}) {
  return (
    <header className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        {back && (
          <Link
            href={back}
            aria-label="Back"
            className="bg-card shadow-card focus-visible:ring-ring/40 grid size-14 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
          >
            <ArrowLeft className="size-5" />
          </Link>
        )}
        <h1
          className={cn(
            "page-title isolate text-balance",
            size === "page" ? "page-title-sm whitespace-normal" : "max-md:text-4xl",
          )}
        >
          {accentFirst(title)}
        </h1>
        {badge}
        {stats && stats.length > 0 && (
          <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 md:ml-2">
            {stats.map(({ value, label }) => (
              <div key={label} className="flex items-baseline gap-2.5">
                <dd className="text-[2.625rem] leading-none font-medium tracking-tight tabular-nums order-first">
                  {value}
                </dd>
                <dt className="text-muted-foreground text-[1.0625rem] font-medium">{label}</dt>
              </div>
            ))}
          </dl>
        )}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {description && (
        <p className="text-muted-foreground max-w-2xl text-[0.9375rem] font-medium text-pretty">
          {description}
        </p>
      )}
    </header>
  );
}
