/**
 * The background half of watching an open posting's client.
 *
 * The content script (`upwork-watch.content`) says which posting a tab has
 * open and when to look again; this half reads Upwork's store in that tab
 * (`readUpworkJob`), reports it (`POST /freelancing/watches`), and turns what
 * the user's own watch saw into an OS notification. It also polls the team
 * feed, so whatever a teammate's watch relays reaches this user too - unless
 * their own watch already told them, which the server marks as `local`.
 *
 * A watch ends when no tab has the posting open any more: this half sees every
 * tab navigate (in-app ones included) and close, so a reload - same posting -
 * keeps the watch, its alerts and its place as relay.
 *
 * Every call is one short request (a refresh waits at most ~20s for Upwork's
 * frame), which a service worker finishes well inside its lifetime.
 */
import { api, ApiError } from "./api";
import { jobKeyOf, readUpworkJob } from "./upwork-store";

export interface Watcher {
  name: string;
  you: boolean;
  notify: boolean;
  relay: boolean;
}

export interface WatchEvent {
  kind: "client_viewed" | "interview_started";
  client_activity_at: string | null;
  interviewing: number | null;
  previous_interviewing: number | null;
}

export interface WatchState {
  job_id: string;
  upwork_id: string;
  title: string;
  url: string | null;
  notify: boolean;
  relay: boolean;
  watchers: Watcher[];
  total_applicants: number | null;
  activity: {
    last_client_activity?: string;
    total_invited_to_interview?: number;
    invites_sent?: number;
    total_unanswered_invites?: number;
    total_hired?: number;
  };
  events: WatchEvent[];
}

interface TeamAlert extends Omit<WatchEvent, "kind"> {
  id: number;
  kind: WatchEvent["kind"];
  job_id: string;
  title: string;
  url: string | null;
  relay_name: string | null;
  local: boolean;
  occurred_at: string;
}

/**
 * How a report reads the posting: `page` the open page (no request to Upwork),
 * `fresh` a background reload of it, `none` a bare heartbeat.
 */
export type ReadMode = "page" | "fresh" | "none";

export type WatchMessage =
  | { type: "watch:report"; key: string; url: string; read: ReadMode }
  | { type: "watch:notify"; key: string; jobId: string; notify: boolean };

export type WatchReply =
  | { ok: true; state: WatchState }
  | { ok: false; error: string; signedOut: boolean };

/** Background -> content: a newer state for the posting, changed from another tab. */
export interface TabMessage {
  type: "watch:state";
  key: string;
  state: WatchState;
}

interface TabWatch {
  key: string;
  jobId: string;
}

const PAGE_WAIT_MS = 8_000;
const FRESH_WAIT_MS = 20_000;
const TEAM_ALARM = "team-alerts";
const TEAM_CURSOR_KEY = "teamAlertsCursor";
// A teammate's alert older than this (the laptop slept) is history, not a nudge.
const TEAM_FRESH_MS = 10 * 60_000;
const TEAM_MAX_SHOWN = 3;
const UPWORK_TABS = "https://www.upwork.com/*";
// tabId -> the posting it watches. Session storage: it outlives the worker, not the browser.
const TABS_KEY = "watchTabs";

export function installWatch(): void {
  chrome.runtime.onMessage.addListener((message: WatchMessage, sender, sendResponse) => {
    if (!message?.type?.startsWith("watch:") || sender.tab?.id === undefined) return false;
    void handle(message, sender.tab).then(sendResponse);
    return true;
  });

  chrome.notifications.onClicked.addListener((id) => void openFrom(id));

  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) void moved(tabId, jobKeyOf(change.url));
  });
  chrome.tabs.onRemoved.addListener((tabId) => void moved(tabId, null));

  // Alarms outlive the worker but not always a browser restart; make sure it is there.
  void chrome.alarms.get(TEAM_ALARM).then((alarm) => {
    if (!alarm) chrome.alarms.create(TEAM_ALARM, { periodInMinutes: 0.5 });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TEAM_ALARM) void pollTeam();
  });
}

async function handle(message: WatchMessage, tab: chrome.tabs.Tab): Promise<WatchReply | void> {
  const tabId = tab.id!;
  try {
    if (message.type === "watch:notify") {
      const state = await api<WatchState>(`/api/v1/freelancing/watches/${message.jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ notify: message.notify }),
      });
      await shareWithTabs(message.key, state, tabId);
      return { ok: true, state };
    }
    return { ok: true, state: await report(message, tab) };
  } catch (error) {
    const signedOut = error instanceof ApiError && (error.status === 401 || error.code === "NO_TOKEN");
    return { ok: false, signedOut, error: error instanceof Error ? error.message : "Something went wrong" };
  }
}

async function report(message: Extract<WatchMessage, { type: "watch:report" }>, tab: chrome.tabs.Tab) {
  // A refresh Upwork refused becomes a heartbeat. Never the open page instead:
  // it may be older than what a teammate just reported, and would undo it.
  const state = message.read === "none" ? null : await read(tab.id!, message.key, message.read === "fresh");
  if (!state && message.read === "page") throw new Error("This job has not finished loading yet.");
  const out = await api<WatchState>("/api/v1/freelancing/watches", {
    method: "POST",
    body: JSON.stringify({ upwork_id: message.key, url: message.url, state }),
  });
  for (const event of out.events) announce(out.title, event, `watch|${tab.id}|${tab.windowId}`);
  await remember(tab.id!, { key: out.upwork_id, jobId: out.job_id });
  return out;
}

async function read(tabId: number, key: string, fresh: boolean): Promise<Record<string, unknown> | null> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: readUpworkJob,
      args: [key, fresh, fresh ? FRESH_WAIT_MS : PAGE_WAIT_MS],
    });
    return (injection?.result as Record<string, unknown> | null | undefined) ?? null;
  } catch {
    return null;
  }
}

async function tabWatches(): Promise<Record<string, TabWatch>> {
  return ((await chrome.storage.session.get(TABS_KEY))[TABS_KEY] as Record<string, TabWatch>) ?? {};
}

async function remember(tabId: number, watch: TabWatch): Promise<void> {
  await chrome.storage.session.set({ [TABS_KEY]: { ...(await tabWatches()), [tabId]: watch } });
}

/**
 * A tab now shows `key` (or nothing, or is gone). If it watched another posting
 * that no other tab still has open, that watch ends.
 */
async function moved(tabId: number, key: string | null): Promise<void> {
  const tabs = await tabWatches();
  const was = tabs[tabId];
  if (!was || was.key === key) return;
  delete tabs[tabId];
  await chrome.storage.session.set({ [TABS_KEY]: tabs });
  if (Object.values(tabs).some((other) => other.key === was.key)) return;
  await api(`/api/v1/freelancing/watches/${was.jobId}`, { method: "DELETE" }).catch(() => undefined);
}

async function shareWithTabs(key: string, state: WatchState, except: number): Promise<void> {
  const tabs = await chrome.tabs.query({ url: UPWORK_TABS });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && tab.id !== except)
      .map((tab) => chrome.tabs.sendMessage<TabMessage>(tab.id!, { type: "watch:state", key, state })),
  );
}

// --- the team feed ---------------------------------------------------------------------

async function pollTeam(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(TEAM_CURSOR_KEY))[TEAM_CURSOR_KEY] as number | undefined;
    if (stored === undefined) {
      // First run: start from now rather than replaying the team's history.
      const { cursor } = await api<{ cursor: number }>("/api/v1/freelancing/alerts?limit=1");
      await chrome.storage.local.set({ [TEAM_CURSOR_KEY]: cursor });
      return;
    }
    const feed = await api<{ items: TeamAlert[]; cursor: number }>(
      `/api/v1/freelancing/alerts?after=${stored}&limit=20`,
    );
    await chrome.storage.local.set({ [TEAM_CURSOR_KEY]: feed.cursor });
    const now = Date.now();
    feed.items
      .filter((alert) => !alert.local && now - Date.parse(alert.occurred_at) < TEAM_FRESH_MS)
      .slice(0, TEAM_MAX_SHOWN)
      .reverse()
      .forEach((alert) => announce(alert.title, alert, `team|${alert.url ?? "https://www.upwork.com/"}`, alert.relay_name));
  } catch {
    // Signed out or offline: the next alarm tries again.
  }
}

// --- notifications --------------------------------------------------------------------

function ago(iso: string | null): string {
  if (!iso) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return "just now";
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
}

function announce(title: string, event: WatchEvent, target: string, relay?: string | null): void {
  const viewed = event.kind === "client_viewed";
  const detail = viewed
    ? `Active ${ago(event.client_activity_at)}`
    : `Interviewing ${event.previous_interviewing ?? "?"} → ${event.interviewing ?? "?"}`;
  chrome.notifications.create(`${target}|${Date.now()}|${event.kind}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon/128.png"),
    title: viewed ? "Client is viewing this job" : "Client started interviewing",
    message: title,
    contextMessage: relay ? `${detail} · via ${relay}` : detail,
    priority: 2,
  });
}

/** A watch's own alert focuses its tab; a teammate's opens the posting (or the tab that has it). */
async function openFrom(id: string): Promise<void> {
  const [kind, ...rest] = id.split("|");
  if (kind === "watch") {
    const [tabId, windowId] = rest.map(Number);
    await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
    await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
  } else if (kind === "team") {
    const url = rest[0];
    const key = url.match(/~0[12][0-9a-f]{10,40}/i)?.[0].toLowerCase();
    const open = key
      ? (await chrome.tabs.query({ url: UPWORK_TABS })).find((tab) => tab.url?.toLowerCase().includes(key))
      : undefined;
    if (open?.id !== undefined) {
      await chrome.tabs.update(open.id, { active: true });
      if (open.windowId !== undefined) await chrome.windows.update(open.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  } else {
    return;
  }
  chrome.notifications.clear(id);
}
