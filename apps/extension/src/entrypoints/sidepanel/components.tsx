import type { ReactNode } from "react";

export interface Upcoming {
  meeting: { id: string; title: string; starts_at: string; conferencing_url: string | null };
  company_name: string | null;
  stage_name: string | null;
  starts_in_minutes: number;
}

const TZ = "America/New_York";

export function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ,
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
    <div className={`banner ${soon ? "soon" : ""}`}>
      <div className="row">
        <span className="badge">Next call</span>
        <strong className="truncate">{upcoming.meeting.title}</strong>
        <span style={{ marginLeft: "auto" }}>{relative(upcoming.starts_in_minutes)}</span>
      </div>
      <div className="small muted" style={{ marginTop: 3 }}>
        {[upcoming.company_name, upcoming.stage_name].filter(Boolean).join(" · ")}
        {upcoming.company_name && " — "}
        {fmt(upcoming.meeting.starts_at)}
      </div>
      {upcoming.meeting.conferencing_url && (
        <a
          className="small"
          href={upcoming.meeting.conferencing_url}
          target="_blank"
          rel="noreferrer"
        >
          Join
        </a>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Progress({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="row small" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <span>{label}</span>
        <span className="muted">{pct}%</span>
      </div>
      <div className="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Err({ children }: { children: ReactNode }) {
  return <p className="err small">{children}</p>;
}
