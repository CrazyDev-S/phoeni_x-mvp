import { useId, type ComponentType, type ReactNode } from "react";

import { Panel, PanelHead } from "@/components/panel";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { ControlProps } from "@/components/form-field";

/**
 * One block of the Settings page: a titled panel. `id` is the anchor the
 * sub-navigation and the `?tab=` deep links scroll to.
 */
export function SettingsSection({
  id,
  title,
  children,
  className,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  className?: string;
  /** Accepted for older call sites. */
  icon?: ComponentType<{ className?: string }>;
  description?: ReactNode;
}) {
  return (
    <section
      id={id}
      data-settings-section={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="scroll-mt-14"
    >
      <Panel className={className}>
        <PanelHead title={<span id={id ? `${id}-title` : undefined}>{title}</span>} />
        <div className="p-3">{children}</div>
      </Panel>
    </section>
  );
}

/** A small caps heading with a rule running out of it, to split a section in two. */
export function SubHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        "text-subtle mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase",
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
    <p className={cn("text-xs leading-snug", quiet ? "text-subtle" : "text-muted-foreground", className)}>
      {children}
    </p>
  );
}

/** A rule between two parts of a section. */
export function Rule({ className }: { className?: string }) {
  return <div role="separator" className={cn("bg-border my-3 h-px", className)} />;
}

/**
 * A label on the left and its control on the right, one line of a form. The
 * control is a function so the label can be tied to whatever it renders.
 */
export function SettingRow({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: (control: ControlProps) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "grid gap-1 py-2 not-first:border-t sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-start sm:gap-4",
        className,
      )}
    >
      <div className="sm:pt-1.5">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </Label>
        {hint && <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{hint}</p>}
      </div>
      <div className="min-w-0 sm:max-w-md">{children({ id })}</div>
    </div>
  );
}

/** A ruled row: the leading icon, a name, and what belongs at its far end. Rows in a list sit in `li`s and are separated by a rule. */
export function Row({
  icon: Icon,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
  /** Accepted for older call sites. */
  tone?: "soft" | "white";
  iconTone?: "default" | "success";
}) {
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 [li:not(:first-child)>&]:border-t",
        className,
      )}
    >
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      {children}
    </div>
  );
}
