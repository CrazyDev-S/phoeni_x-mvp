/**
 * The background half of the portal's Refresh: keep the relay registered for
 * the portal URL in Settings, and refresh every open Upwork list at once,
 * tallying what the reloaded pages bring in.
 */
import { getSettings } from "./api";
import { PORTAL_BRIDGE_SCRIPT, PORTAL_URL_KEY, TOKEN_KEY, UPWORK_PAUSED_KEY } from "./constants";
import { refreshOf } from "./upwork-capture";

export interface UpworkCheckAll {
  /** Upwork tabs showing a search or feed, each refreshed. */
  lists: number;
  /** Postings those refreshes put in the shared list for the first time. */
  added: number;
  /** Refreshes that did not come back with postings, or whose postings were not saved. */
  failed: number;
  paused: boolean;
  signedOut: boolean;
}

const BRIDGE_ID = "portal-bridge";
// A refreshed Upwork page loads, settles and reports well inside this.
const REFRESH_WAIT_MS = 30_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

export function installPortalBridge(): void {
  chrome.runtime.onInstalled.addListener(() => void syncBridge());
  chrome.runtime.onStartup.addListener(() => void syncBridge());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PORTAL_URL_KEY]) void syncBridge();
  });
  chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
    if (message?.type !== "upwork:check-all") return false;
    void checkAll().then(sendResponse);
    return true;
  });
}

/** Where the portal lives. Both loopback names are this machine, and people type either. */
function portalPatterns(portalUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(portalUrl);
  } catch {
    return [];
  }
  const port = url.port ? `:${url.port}` : "";
  const hosts = LOOPBACK.has(url.hostname) ? [...LOOPBACK] : [url.hostname];
  return hosts.map((host) => `${url.protocol}//${host}${port}/*`);
}

async function syncBridge(): Promise<void> {
  const matches = portalPatterns((await getSettings()).portalUrl);
  await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => undefined);
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([{ id: BRIDGE_ID, matches, js: [PORTAL_BRIDGE_SCRIPT], runAt: "document_idle" }]);
  // Portal tabs already open get the relay now rather than on their next load.
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined ? [] : [chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [PORTAL_BRIDGE_SCRIPT] })],
    ),
  );
}

async function checkAll(): Promise<UpworkCheckAll> {
  const local = await chrome.storage.local.get([UPWORK_PAUSED_KEY, TOKEN_KEY]);
  const out: UpworkCheckAll = {
    lists: 0,
    added: 0,
    failed: 0,
    paused: Boolean(local[UPWORK_PAUSED_KEY]),
    signedOut: !local[TOKEN_KEY],
  };
  if (out.paused || out.signedOut) return out;

  const tabs = await chrome.tabs.query({ url: "https://www.upwork.com/*" });
  // A tab showing a list says so and refreshes; the result is its reloaded page's first capture.
  const results = await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return undefined;
      const reply = (await chrome.tabs.sendMessage(tab.id, { type: "upwork:check" }).catch(() => null)) as
        | { refreshing: boolean }
        | null;
      return reply?.refreshing ? refreshOf(tab.id, REFRESH_WAIT_MS) : undefined;
    }),
  );
  for (const result of results) {
    if (result === undefined) continue;
    out.lists += 1;
    if (!result || result.added === null) out.failed += 1;
    else out.added += result.added;
  }
  return out;
}
