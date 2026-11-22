/**
 * Upwork capture. Declared for upwork.com only, so it runs while the user
 * browses - panel open or not - and hands each posting it sees to the
 * background, which registers it in the shared job list.
 *
 * It never clicks or scrolls. It reads again whenever the page changes (a feed
 * loading more, a search paging, a posting opening beside the list) and sends
 * only what changed. A list left open - a search, a feed - is refreshed every
 * few minutes, as the user would with F5, so postings made since it loaded
 * show up on screen and in the shared list. A refresh never lands on someone
 * using the tab: not while a posting is open over the list, and not within a
 * minute of them clicking, typing or scrolling in it.
 */
import type { CaptureMessage, CaptureReply } from "@/lib/upwork-capture";
import { TOKEN_KEY, UPWORK_CHECK_MS, UPWORK_PAUSED_KEY } from "@/lib/constants";
import { fingerprint, harvest, jobKey, readsJobs, type CapturedJob } from "@/lib/upwork";

declare global {
  interface Window {
    __phoenixUpwork?: boolean;
  }
}

const SETTLE_MS = 1200;
const MAX_WAIT_MS = 4000;
// Jitter, so refreshes are never a perfectly regular beat.
const CHECK_JITTER_MS = 30_000;
// Someone clicked, typed or scrolled in the tab this recently: they are using it.
const IN_USE_MS = 60_000;
// Survives the reload (per tab), so the page that comes back knows it was a refresh.
const REFRESHED_KEY = "phoenix.upwork.refreshed";

// "Posted 3 minutes ago" ticks on its own; that is not a change worth sending.
const TICKING = /\b(\d+|an?)\s+(second|minute|hour)s?\s+ago\b/gi;

/** A list of postings with none open over it: a search, a feed. Not a posting's own page. */
function isList(loc: Location): boolean {
  return readsJobs(loc) && !jobKey(loc.pathname);
}

/** Whether this page load is a refresh this script asked for; asking clears it. */
function takeRefreshed(): boolean {
  try {
    const was = sessionStorage.getItem(REFRESHED_KEY) !== null;
    sessionStorage.removeItem(REFRESHED_KEY);
    return was;
  } catch {
    return false;
  }
}

export default defineContentScript({
  matches: ["https://www.upwork.com/*"],
  runAt: "document_idle",
  main() {
    // Injected again into tabs already open when the extension installs.
    if (window.__phoenixUpwork) return;
    window.__phoenixUpwork = true;

    const sent = new Map<string, string>();
    let lastPage = "";
    let onPage: string[] = [];
    let timer: number | undefined;
    let waitingSince = 0;
    // The list this tab refreshes (its address), and when it next does.
    let list: string | null = null;
    let nextCheck: string | null = null;
    let checkTimer: number | undefined;
    let lastUse = 0;
    // This load is a refresh: the first read with postings reports what it brought in.
    let refreshed = takeRefreshed();

    const observer = new MutationObserver(() => schedule());

    function stop() {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(checkTimer);
    }

    function schedule() {
      // The extension was reloaded or removed; this copy has no one to talk to.
      if (!chrome.runtime?.id) return stop();
      const now = Date.now();
      waitingSince ||= now;
      clearTimeout(timer);
      timer = window.setTimeout(() => void read(false), Math.min(SETTLE_MS, Math.max(0, MAX_WAIT_MS - (now - waitingSince))));
    }

    /** The postings that are new or changed since this page last sent them. */
    function fresh(jobs: CapturedJob[]): CapturedJob[] {
      return jobs.filter((job) => {
        const id = `${job.upwork_id}|${job.view}`;
        const print = fingerprint({ ...job, text: job.text.replace(TICKING, "") });
        if (sent.get(id) === print) return false;
        sent.set(id, print);
        return true;
      });
    }

    async function deliver(jobs: CapturedJob[], check?: CaptureMessage["check"]): Promise<CaptureReply | undefined> {
      const message: CaptureMessage = { type: "upwork:capture", jobs, onPage, page: location.href, nextCheck, check };
      try {
        const reply = (await chrome.runtime.sendMessage(message)) as CaptureReply | undefined;
        // Not saved (paused, signed out, offline): send these again next time.
        if (!reply?.ok) jobs.forEach((job) => sent.delete(`${job.upwork_id}|${job.view}`));
        return reply;
      } catch {
        stop();
        return undefined;
      }
    }

    async function read(force: boolean) {
      waitingSince = 0;
      if (force) sent.clear();
      const jobs = harvest(document, location);
      onPage = [...new Set(jobs.map((job) => job.upwork_id))];
      const moved = follow();
      const check = refreshed && jobs.length ? { found: onPage.length } : undefined;
      if (check) refreshed = false;
      const changed = fresh(jobs);
      const page = `${location.pathname}|${onPage.join(",")}`;
      if (!changed.length && page === lastPage && !moved && !check) return;
      lastPage = page;
      await deliver(changed, check);
    }

    /** Point the refresh at what the page now shows; a new list waits a full interval. */
    function follow(): boolean {
      const next = isList(location) ? location.href : null;
      if (next === list) return false;
      list = next;
      plan(UPWORK_CHECK_MS + Math.random() * CHECK_JITTER_MS);
      return true;
    }

    function plan(wait: number) {
      clearTimeout(checkTimer);
      if (!list) {
        nextCheck = null;
        return;
      }
      nextCheck = new Date(Date.now() + wait).toISOString();
      checkTimer = window.setTimeout(() => void due(), wait);
    }

    /** Collecting and connected: a refresh would be saved. Otherwise Upwork is not asked. */
    async function canRefresh(): Promise<boolean> {
      if (!chrome.runtime?.id || !isList(location)) return false;
      const local = await chrome.storage.local.get([UPWORK_PAUSED_KEY, TOKEN_KEY]);
      return !local[UPWORK_PAUSED_KEY] && Boolean(local[TOKEN_KEY]);
    }

    function reloadNow() {
      try {
        sessionStorage.setItem(REFRESHED_KEY, String(Date.now()));
      } catch {
        // Storage blocked: the page still refreshes, it just is not reported as one.
      }
      location.reload();
    }

    async function due() {
      if (!isList(location)) {
        follow();
        return;
      }
      const idle = Date.now() - lastUse;
      if (!document.hidden && idle < IN_USE_MS) {
        // In use: try again a minute after they stopped, and tell the panel when.
        plan(IN_USE_MS - idle);
        await deliver([]);
        return;
      }
      if (await canRefresh()) reloadNow();
      else plan(UPWORK_CHECK_MS + Math.random() * CHECK_JITTER_MS);
    }

    chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
      if (message?.type === "upwork:check") {
        // The portal's Refresh: refresh this tab now if it shows a list. The
        // answer goes first; what the refresh brings in arrives as its capture.
        void canRefresh().then((refreshing) => {
          sendResponse({ refreshing });
          if (refreshing) window.setTimeout(reloadNow, 50);
        });
        return true;
      }
      if (message?.type !== "upwork:rescan") return false;
      // The panel's button: refresh a list now, or read any other page again.
      void canRefresh().then(async (refreshing) => {
        if (refreshing) {
          sendResponse({ ok: true });
          window.setTimeout(reloadNow, 50);
        } else {
          await read(true);
          sendResponse({ ok: true });
        }
      });
      return true;
    });
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      window.addEventListener(type, () => (lastUse = Date.now()), { capture: true, passive: true });
    }
    observer.observe(document.body, { childList: true, subtree: true });
    // Background tabs are read too: a refresh of a tab nobody is looking at
    // must still reach the shared list.
    schedule();
  },
});
