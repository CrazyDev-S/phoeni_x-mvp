import { Bell, BellOff, ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Watcher, WatchState } from "@/lib/upwork-watch";

export type View =
  | { kind: "loading" }
  | { kind: "watching"; state: WatchState; refreshing?: boolean; problem?: string }
  | { kind: "error"; error: string; signedOut: boolean };

// A client seen this recently is on the posting now.
const HERE_MS = 5 * 60_000;
const MINIMIZED_KEY = "watchCardMinimized";

export function Card({ view, onNotify }: { view: View; onNotify: (notify: boolean) => Promise<void> }) {
  const [minimized, setMinimized] = useMinimized();

  if (view.kind === "loading") {
    return (
      <div className="dock">
        <div className="pill quiet">
          <LoaderCircle className="spin" />
          Reading this job…
        </div>
      </div>
    );
  }
  if (view.kind === "error") {
    return (
      <div className="dock">
        <div className="card note">
          <p className="note-title">{view.signedOut ? "Sign in to watch this client" : "Can't watch this job yet"}</p>
          <p className="note-body">
            {view.signedOut ? "Add your access token in the PhoeniX panel (Alt+Shift+J)." : view.error}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="dock">
      <Watching
        {...view}
        minimized={minimized}
        onMinimize={setMinimized}
        onNotify={onNotify}
      />
    </div>
  );
}

function Watching({
  state,
  refreshing,
  problem,
  minimized,
  onMinimize,
  onNotify,
}: {
  state: WatchState;
  refreshing?: boolean;
  problem?: string;
  minimized: boolean;
  onMinimize: (minimized: boolean) => void;
  onNotify: (notify: boolean) => Promise<void>;
}) {
  const now = useNow();
  const [pending, setPending] = useState<boolean | null>(null);
  const notify = pending ?? state.notify;
  const seen = state.activity.last_client_activity ? Date.parse(state.activity.last_client_activity) : null;
  const here = seen !== null && now - seen <= HERE_MS;

  const toggle = async () => {
    setPending(!notify);
    try {
      await onNotify(!notify);
    } finally {
      setPending(null);
    }
  };

  if (minimized) {
    return (
      <button type="button" className="pill" data-here={here} onClick={() => onMinimize(false)} title="Show client watch">
        <Beacon here={here} />
        {seen === null ? "Watching" : here ? "Client is here" : ago(seen, now)}
        {notify ? <Bell /> : <BellOff className="dim" />}
      </button>
    );
  }

  const others = state.watchers.filter((w) => !w.you);
  return (
    <section className="card" data-here={here} aria-label="PhoeniX client watch">
      <header className="head">
        <Beacon here={here} />
        <span className="eyebrow">Client watch</span>
        {refreshing && <RefreshCw className="spin dim" aria-label="Checking" />}
        <span className="grow" />
        <button type="button" className="icon" onClick={() => onMinimize(true)} aria-label="Minimize">
          <ChevronDown />
        </button>
      </header>

      <div className="hero">
        <span className="hero-label">{here ? "Client is on this job" : "Client last active"}</span>
        <span className="hero-value" data-here={here}>
          {seen === null ? "Not seen yet" : ago(seen, now)}
        </span>
      </div>

      <dl className="stats">
        <Stat label="Proposals" value={state.total_applicants} />
        <Stat label="Interviewing" value={state.activity.total_invited_to_interview} />
        <Stat label="Invites" value={state.activity.invites_sent} />
        <Stat label="Hired" value={state.activity.total_hired} />
      </dl>

      <footer className="foot">
        <button
          type="button"
          role="switch"
          aria-checked={notify}
          className="switch"
          onClick={() => void toggle()}
          disabled={pending !== null}
          title={notify ? "Turn your alerts off" : "Check this job myself and alert me"}
        >
          <span className="knob" />
        </button>
        <span className="who">{whoLine(state, notify)}</span>
        <Faces watchers={others} />
      </footer>
      {problem && <p className="problem">{problem}</p>}
    </section>
  );
}

function whoLine(state: WatchState, notify: boolean): string {
  const relay = state.watchers.find((w) => w.relay && !w.you);
  if (notify) return state.relay ? "You relay this job to the team" : `Alerts on · ${relay?.name ?? "a teammate"} relays`;
  return relay ? `${relay.name} relays · you get their alerts` : "Alerts off · nobody relays this job";
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  const previous = useRef(value);
  const [rose, setRose] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (value == null || before == null || value <= before) return;
    setRose(true);
    const timer = setTimeout(() => setRose(false), 1400);
    return () => clearTimeout(timer);
  }, [value]);
  return (
    <div className="stat" data-rose={rose}>
      <dt>{label}</dt>
      <dd>{value ?? "–"}</dd>
    </div>
  );
}

function Faces({ watchers }: { watchers: Watcher[] }) {
  if (!watchers.length) return null;
  const shown = watchers.slice(0, 3);
  return (
    <span className="faces" title={watchers.map((w) => w.name + (w.relay ? " (relays)" : "")).join(", ")}>
      {shown.map((w, index) => (
        <span key={`${index}-${w.name}`} className="face" data-relay={w.relay}>
          {initials(w.name)}
        </span>
      ))}
      {watchers.length > shown.length && <span className="face more">+{watchers.length - shown.length}</span>}
    </span>
  );
}

function Beacon({ here }: { here: boolean }) {
  return <span className="beacon" data-here={here} aria-hidden />;
}

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Ticks every second, so "12s ago" counts up while the card is on screen. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** In the extension's storage, not Upwork's: the page's localStorage is theirs. */
function useMinimized(): [boolean, (minimized: boolean) => void] {
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get(MINIMIZED_KEY).then((stored) => setMinimized(Boolean(stored[MINIMIZED_KEY])));
  }, []);
  const set = (next: boolean) => {
    setMinimized(next);
    void chrome.storage.local.set({ [MINIMIZED_KEY]: next });
  };
  return [minimized, set];
}
