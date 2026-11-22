/**
 * The background half of Upwork capture: what the content script read goes to
 * the shared job list, and the tally the panel shows is kept here.
 *
 * Each request is one short POST, which the service worker finishes well inside
 * its lifetime - unlike a tailoring run, which is why that lives in the panel.
 */
import { getSettings } from "./api";
import { UPWORK_PAUSED_KEY, UPWORK_STATS_KEY, UPWORK_TAB_PREFIX } from "./constants";
import type { CapturedJob } from "./upwork";

export interface CaptureMessage {
  type: "upwork:capture";
  /** Postings that are new or changed since this page last sent them. */
  jobs: CapturedJob[];
  /** Every posting key on the page right now, for the panel's "on this page". */
  onPage: string[];
  page: string;
  /** When this tab next refreshes; null when it shows no list (a posting is open). */
  nextCheck: string | null;
  /** Set on the first read of a page this extension refreshed: how many postings it shows. */
  check?: { found: number };
}

export interface CaptureReply {
  ok: boolean;
  /** Postings this capture put in the shared list for the first time. */
  added?: number;
}

export interface UpworkCheck {
  at: string;
  /** Postings the refreshed page showed. */
  found: number;
  /** Of those, how many were new to the shared list; null when they were not saved. */
  added: number | null;
}

/** What one tab's refresh brought in. */
export type CheckResult = Pick<UpworkCheck, "found" | "added">;

// Tabs refreshing for someone waiting on the result (the portal's Refresh).
const refreshing = new Map<number, (result: CheckResult | null) => void>();

/** What tab `tabId`'s refresh brings in, from the first capture the reloaded page sends; null if none comes. */
export function refreshOf(tabId: number, timeoutMs: number): Promise<CheckResult | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(null), timeoutMs);
    const settle = (result: CheckResult | null) => {
      clearTimeout(timer);
      refreshing.delete(tabId);
      resolve(result);
    };
    refreshing.get(tabId)?.(null);
    refreshing.set(tabId, settle);
  });
}

export interface UpworkRecent {
  id: string;
  upwork_id: string;
  title: string;
  /** This capture put the posting in the shared list. */
  created: boolean;
  at: string;
}

export interface UpworkStats {
  day: string;
  /** Distinct postings captured today, so a re-render is not counted twice. */
  keys: string[];
  added: number;
  recent: UpworkRecent[];
  error: string | null;
  at: string | null;
}

export interface UpworkTabState {
  url: string;
  keys: string[];
  at: string;
  nextCheck: string | null;
  lastCheck: UpworkCheck | null;
}

interface CaptureOut {
  received: number;
  created: number;
  jobs: { upwork_id: string; id: string; title: string; created: boolean }[];
}

const BATCH = 50;
const RECENT = 12;

function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function emptyStats(): UpworkStats {
  return { day: today(), keys: [], added: 0, recent: [], error: null, at: null };
}

async function readStats(): Promise<UpworkStats> {
  const stored = (await chrome.storage.local.get(UPWORK_STATS_KEY))[UPWORK_STATS_KEY] as UpworkStats | undefined;
  return stored && stored.day === today() ? stored : { ...emptyStats(), recent: stored?.recent ?? [] };
}

async function writeStats(update: (stats: UpworkStats) => UpworkStats): Promise<void> {
  await chrome.storage.local.set({ [UPWORK_STATS_KEY]: update(await readStats()) });
}

// Tabs report at once; stats are read-modify-write, so they take turns.
let queue: Promise<unknown> = Promise.resolve();

export function handleCapture(message: CaptureMessage, tabId: number | undefined): Promise<CaptureReply> {
  const next = queue.then(() => capture(message, tabId));
  queue = next.catch(() => undefined);
  return next;
}

async function capture(message: CaptureMessage, tabId: number | undefined): Promise<CaptureReply> {
  const saved = message.jobs.length ? await save(message.jobs) : [];
  const added = saved ? saved.filter((job) => job.created).length : null;
  if (tabId !== undefined) {
    await rememberTab(tabId, message, saved);
    if (message.check) refreshing.get(tabId)?.({ found: message.check.found, added });
  }
  return { ok: saved !== null, added: added ?? 0 };
}

/** What the tab shows, for the panel; a check also records what it brought in. */
async function rememberTab(tabId: number, message: CaptureMessage, saved: CaptureOut["jobs"] | null): Promise<void> {
  const key = `${UPWORK_TAB_PREFIX}${tabId}`;
  const at = new Date().toISOString();
  const before = (await chrome.storage.session.get(key))[key] as UpworkTabState | undefined;
  const lastCheck: UpworkCheck | null = message.check
    ? { at, found: message.check.found, added: saved ? saved.filter((job) => job.created).length : null }
    : (before?.lastCheck ?? null);
  const state: UpworkTabState = { url: message.page, keys: message.onPage, at, nextCheck: message.nextCheck, lastCheck };
  await chrome.storage.session.set({ [key]: state });
}

/** The postings registered in the shared list, or null when they were not saved. */
async function save(jobs: CapturedJob[]): Promise<CaptureOut["jobs"] | null> {
  const local = await chrome.storage.local.get(UPWORK_PAUSED_KEY);
  // Paused: nothing is sent, and the page keeps the postings to send on resume.
  if (local[UPWORK_PAUSED_KEY]) return null;
  const { apiBase, token } = await getSettings();
  if (!token) {
    await writeStats((s) => ({ ...s, error: "Add your PhoeniX access token in Settings to start collecting." }));
    return null;
  }

  const saved: CaptureOut["jobs"] = [];
  try {
    for (let i = 0; i < jobs.length; i += BATCH) {
      const res = await fetch(`${apiBase}/api/v1/freelancing/jobs/capture`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: jobs.slice(i, i + BATCH) }),
      });
      if (!res.ok) {
        const reason =
          res.status === 401 ? "Your access token was refused. Paste a fresh one in Settings." : `PhoeniX answered ${res.status}.`;
        await writeStats((s) => ({ ...s, error: reason }));
        return null;
      }
      saved.push(...((await res.json()) as CaptureOut).jobs);
    }
  } catch {
    await writeStats((s) => ({ ...s, error: "Could not reach PhoeniX. Postings are sent again on the next page change." }));
    return null;
  }

  const at = new Date().toISOString();
  await writeStats((s) => {
    const keys = new Set(s.keys);
    let added = s.added;
    for (const job of saved) {
      keys.add(job.upwork_id);
      if (job.created) added += 1;
    }
    // Newest first; within this batch, the postings it added lead the ones it refreshed.
    const fresh = saved.map((job) => ({ ...job, at })).sort((a, b) => Number(b.created) - Number(a.created));
    const recent = [...fresh, ...s.recent.filter((r) => !saved.some((job) => job.upwork_id === r.upwork_id))].slice(0, RECENT);
    return { ...s, keys: [...keys].slice(-5000), added, recent, error: null, at };
  });
  return saved;
}
