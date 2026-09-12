"use client";

import { Button, Spinner } from "@/components/ui";
import { dayLabel, isSameMonth, type DayKey } from "@/lib/calendar";

export type CalendarView = "day" | "week" | "month";

export const VIEWS: { value: CalendarView; label: string; hint: string }[] = [
  { value: "day", label: "Day", hint: "Day view (D)" },
  { value: "week", label: "Week", hint: "Week view (W)" },
  { value: "month", label: "Month", hint: "Month view (M)" },
];

/** "8 – 14 September 2026", collapsing whatever the two ends share. */
export function rangeTitle(view: CalendarView, anchor: DayKey, days: DayKey[]): string {
  if (view === "day") return dayLabel(anchor, "EEEE d MMMM yyyy");
  if (view === "month") return dayLabel(anchor, "MMMM yyyy");

  const [first] = days;
  const last = days[days.length - 1];
  if (isSameMonth(first, last)) {
    return `${dayLabel(first, "d")} – ${dayLabel(last, "d MMMM yyyy")}`;
  }
  const samePattern = first.slice(0, 4) === last.slice(0, 4) ? "d MMM" : "d MMM yyyy";
  return `${dayLabel(first, samePattern)} – ${dayLabel(last, "d MMM yyyy")}`;
}

export function Toolbar({
  view,
  title,
  busy,
  onView,
  onToday,
  onStep,
}: {
  view: CalendarView;
  title: string;
  busy?: boolean;
  onView: (view: CalendarView) => void;
  onToday: () => void;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={onToday}>Today</Button>
      <div className="flex items-center gap-1">
        <IconButton label="Previous" onClick={() => onStep(-1)}>
          <Chevron direction="left" />
        </IconButton>
        <IconButton label="Next" onClick={() => onStep(1)}>
          <Chevron direction="right" />
        </IconButton>
      </div>
      <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        {title}
        {busy && <Spinner className="text-[var(--color-ink-soft)]" />}
      </h1>

      <div className="ml-auto flex rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5">
        {VIEWS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            aria-pressed={view === option.value}
            onClick={() => onView(option.value)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              view === option.value
                ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                : "text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]"
    >
      {children}
    </button>
  );
}

export function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current stroke-2">
      <path
        d={direction === "left" ? "M15 5 8 12l7 7" : "M9 5l7 7-7 7"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
