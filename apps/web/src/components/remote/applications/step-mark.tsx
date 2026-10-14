import { CalendarClock } from "lucide-react";

import { cn } from "@/lib/utils";
import { stageStatus } from "./shared";

/**
 * One interview step's status as a round mark: the icon carries the meaning
 * and the colour only reinforces it. A step still ahead of you is an empty
 * ring, a step that was cut short a dash.
 *
 * `raised` is for marks drawn on the accent-filled row, where the pale tints
 * would disappear into the fill.
 */
export function StepMark({
  status,
  size = "md",
  raised = false,
  onDark = false,
  className,
}: {
  status: string;
  size?: "sm" | "md";
  raised?: boolean;
  /** Drawn on a charcoal fold, where the dark mark would vanish. */
  onDark?: boolean;
  className?: string;
}) {
  const { Icon } = stageStatus(status);
  const open = status === "pending";
  const cut = status === "skipped" || status === "cancelled";

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        size === "md" ? "size-[30px] [&_svg]:size-[15px]" : "size-[22px] [&_svg]:size-3",
        status === "passed" && (raised ? "bg-card text-success" : "bg-success/15 text-success"),
        status === "scheduled" && (onDark ? "bg-brand text-brand-foreground" : "bg-panel text-brand"),
        status === "in_progress" && "bg-info/15 text-info",
        status === "failed" &&
          (raised ? "bg-card text-destructive" : "bg-destructive/12 text-destructive"),
        (status === "waiting_feedback" || status === "rescheduled" || status === "no_show") &&
          (raised ? "bg-card text-warning" : "bg-warning/18 text-warning"),
        open &&
          (raised
            ? "bg-white/35 shadow-[inset_0_0_0_1.6px_rgb(0_0_0/0.28)]"
            : "shadow-[inset_0_0_0_1.6px_color-mix(in_oklab,var(--foreground)_24%,transparent)]"),
        cut && "text-subtle",
        className,
      )}
    >
      {open ? null : status === "scheduled" ? <CalendarClock /> : <Icon />}
    </span>
  );
}

const MARK_COLORS = [
  "bg-panel",
  "bg-brand text-brand-foreground",
  "bg-info",
  "bg-success",
  "bg-warning",
  "bg-destructive",
];

/** The company's initial on a colour picked from its name, so each stays recognisable. */
export function CompanyMark({ name, className }: { name: string; className?: string }) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-[13px] text-base font-extrabold text-white",
        MARK_COLORS[hash % MARK_COLORS.length],
        className,
      )}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
