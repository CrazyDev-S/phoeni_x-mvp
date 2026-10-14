import type { ComponentType, ReactNode } from "react";

import { Tile } from "@/components/tile";
import { cn } from "@/lib/utils";

/**
 * One block of the Settings page: a white card led by an accent tile, a title
 * and a line of what it is for. `id` is the anchor the sub-navigation and the
 * `?tab=` deep links scroll to.
 */
export function SettingsSection({
  id,
  icon,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-settings-section={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        "bg-card shadow-card scroll-mt-6 rounded-[40px] px-6 py-8 sm:px-9 sm:py-[34px]",
        className,
      )}
    >
      <header className="mb-[26px] flex items-start gap-4">
        <Tile icon={icon} className="size-[52px] rounded-[18px]" />
        <div className="min-w-0">
          <h2
            id={id ? `${id}-title` : undefined}
            className="text-[1.75rem] leading-[1.1] font-medium tracking-[-0.015em]"
          >
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground mt-1.5 max-w-[660px] text-[0.90625rem] leading-snug font-medium text-pretty">
              {description}
            </p>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

/** A small caps heading with a rule running out of it, to split a section in two. */
export function SubHead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-subtle mb-3.5 flex items-center gap-3.5 text-[13px] font-bold tracking-[0.07em] uppercase",
        "after:bg-border after:h-px after:flex-1 after:content-['']",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/** A quiet line of help under a control. */
export function Hint({
  children,
  quiet,
  className,
}: {
  children: ReactNode;
  /** Fainter still, for the small print at the foot of a block. */
  quiet?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[0.78rem] leading-snug font-medium",
        quiet ? "text-subtle" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A rule between two parts of a section. */
export function Rule({ className }: { className?: string }) {
  return (
    <div role="separator" className={cn("bg-border my-7 h-px", className)} />
  );
}

/** A soft rounded row: the leading icon, a name, and what belongs at its far end. */
export function Row({
  icon: Icon,
  children,
  tone = "soft",
  iconTone = "default",
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  tone?: "soft" | "white";
  iconTone?: "default" | "success";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[22px] p-3",
        tone === "soft" ? "bg-soft" : "bg-card",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-[38px] shrink-0 place-items-center rounded-full",
          iconTone === "success"
            ? "bg-success/15 text-success"
            : tone === "soft"
              ? "bg-card text-muted-foreground"
              : "bg-soft text-muted-foreground",
        )}
      >
        <Icon className="size-[17px]" />
      </span>
      {children}
    </div>
  );
}
