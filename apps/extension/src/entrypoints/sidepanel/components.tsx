import { AlertCircle, CalendarClock, Video } from "lucide-react";
import { useId, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface Upcoming {
  meeting: {
    id: string;
    title: string;
    starts_at: string;
    conferencing_url: string | null;
  };
  company_name: string | null;
  stage_name: string | null;
  starts_in_minutes: number;
}

const DISPLAY_TIME_ZONE = "America/New_York";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relative(minutes: number): string {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 1440) return `in ${Math.round(minutes / 60)}h`;
  const days = Math.round(minutes / 1440);
  return days === 1 ? "tomorrow" : `in ${days}d`;
}

/** Pinned at the top of the panel: the single next call across all job types. */
export function NextCall({ upcoming }: { upcoming: Upcoming | null }) {
  if (!upcoming) return null;
  const soon = upcoming.starts_in_minutes <= 120;

  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        soon ? "border-primary/40 bg-accent" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            soon ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <CalendarClock className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{upcoming.meeting.title}</p>
          <p className="text-muted-foreground truncate text-[11px]">
            {[upcoming.company_name, upcoming.stage_name].filter(Boolean).join(" · ") ||
              "Next call"}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 text-[11px] font-semibold tabular-nums",
            soon ? "text-primary" : "text-muted-foreground",
          )}
        >
          {relative(upcoming.starts_in_minutes)}
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <p className="text-subtle min-w-0 flex-1 truncate text-[10px] tabular-nums">
          {formatDateTime(upcoming.meeting.starts_at)}
        </p>
        {upcoming.meeting.conferencing_url && (
          <Button asChild size="xs" variant={soon ? "default" : "outline"}>
            <a href={upcoming.meeting.conferencing_url} target="_blank" rel="noreferrer">
              <Video />
              Join
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Label, control and help text.
 *
 * The control is a function of its id rather than a plain child: shadcn's
 * Select renders a button, not a <select>, so the label cannot simply wrap it.
 */
export function PanelField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (control: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <Field>
      <FieldLabel htmlFor={id} className="text-xs">
        {label}
      </FieldLabel>
      {children({ id, "aria-describedby": hint ? hintId : undefined })}
      {hint && (
        <FieldDescription id={hintId} className="text-[11px]">
          {hint}
        </FieldDescription>
      )}
    </Field>
  );
}

export function Progress({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="min-w-0 truncate">{label}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{percent}%</span>
      </div>
      <ProgressBar value={percent} aria-label={label} className="h-1.5" />
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription className="text-xs">{children}</AlertDescription>
    </Alert>
  );
}
