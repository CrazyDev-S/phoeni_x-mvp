import { useEffect, useState } from "react";

import { getSettings } from "@/lib/api";
import { NEXT_CALL_KEY, ROUTE_KEY } from "@/lib/constants";
import { ApplyTab } from "./tabs/Apply";
import { CalendarTab } from "./tabs/Calendar";
import { GenerateTab } from "./tabs/Generate";
import { MaintainTab } from "./tabs/Maintain";
import { SettingsTab } from "./tabs/Settings";
import { NextCall, type Upcoming } from "./components";

const TABS = [
  ["apply", "Apply"],
  ["generate", "Generate"],
  ["calendar", "Calendar"],
  ["maintain", "Jobs"],
  ["settings", "Settings"],
] as const;

type Route = (typeof TABS)[number][0];

export function App() {
  const [route, setRoute] = useState<Route>("apply");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [next, setNext] = useState<Upcoming | null>(null);

  useEffect(() => {
    // The panel document is destroyed when the panel closes, so the last route
    // is restored from session storage rather than kept in memory.
    void chrome.storage.session.get(ROUTE_KEY).then((s) => {
      const stored = (s as Record<string, string | undefined>)[ROUTE_KEY];
      if (stored) setRoute(stored as Route);
    });
    void getSettings().then((s) => setConfigured(Boolean(s.token)));
    void chrome.storage.local
      .get(NEXT_CALL_KEY)
      .then((s) => setNext(((s as Record<string, Upcoming | undefined>)[NEXT_CALL_KEY]) ?? null));

    // The service worker writes the next call here on its alarm. storage
    // events are idempotent and survive the panel being closed, which
    // runtime.sendMessage would not.
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[NEXT_CALL_KEY]) {
        setNext((changes[NEXT_CALL_KEY].newValue as Upcoming | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  function go(next: Route) {
    setRoute(next);
    void chrome.storage.session.set({ [ROUTE_KEY]: next });
  }

  if (configured === null) return <div className="body muted">Loading…</div>;

  return (
    <div className="panel">
      <nav className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={route === key}
            className="tab"
            onClick={() => go(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="body">
        <NextCall upcoming={next} />

        {!configured && route !== "settings" ? (
          <div className="card">
            <p style={{ margin: "0 0 8px" }}>
              Connect this panel to your Resume Assist backend to get started.
            </p>
            <button className="btn primary block" onClick={() => go("settings")}>
              Open settings
            </button>
          </div>
        ) : (
          <>
            {route === "apply" && <ApplyTab />}
            {route === "generate" && <GenerateTab />}
            {route === "calendar" && <CalendarTab />}
            {route === "maintain" && <MaintainTab />}
            {route === "settings" && <SettingsTab onSaved={() => setConfigured(true)} />}
          </>
        )}
      </div>
    </div>
  );
}
