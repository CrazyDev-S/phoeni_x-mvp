/**
 * Reading a freelancer's Upwork profile, for the portal's "fill from link".
 *
 * The link opens in a background tab beside the portal, in the user's own
 * browser: signed in, past Upwork's bot checks, the profile as they see it.
 * Each page is read once it settles: the link's page, then every other view of
 * the same freelancer it links to (its specialized profiles). The tab closes
 * when done, whatever happens.
 *
 * Like the job harvest (`./upwork`), this knows as little about Upwork as it
 * can: a page's visible text. What the text means is the backend's business
 * (`app.freelancing.profile_import`), so an Upwork redesign is a server fix,
 * not an extension release.
 */

export interface ProfileView {
  url: string;
  title: string | null;
  text: string;
}

export type ProfileRead =
  | { ok: true; views: ProfileView[] }
  | { ok: false; reason: "not-a-profile" | "signed-out" | "blocked" | "unreadable" };

interface PageRead extends ProfileView {
  /** Other views of the same freelancer the page links to. */
  links: string[];
}

// /freelancers/~01abc or /freelancers/name, /fl/name, and the old /o/profiles/users/~01abc.
const PROFILE_PATH = /^\/(freelancers|fl)\/[^/]+\/?$|^\/o\/profiles\/users\/[^/]+\/?$/i;
const SIGN_IN_PATH = /login|account-security|signup/i;
const BOT_CHECK = /verify you are human|just a moment|checking your browser|unusual traffic|press (and|&) hold/i;
// The link's page and its specialized profiles (Upwork allows a handful).
const MAX_VIEWS = 6;
const LOAD_MS = 30_000;
const SETTLE_MS = 12_000;
// Past this, the views read so far are what the portal gets.
const TOTAL_MS = 75_000;

/** The profile link in what someone typed or pasted, as a full URL; null when it is not one. */
export function profileLink(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/(^|\.)upwork\.com$/i.test(url.hostname) || !PROFILE_PATH.test(url.pathname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function installProfileReader(): void {
  chrome.runtime.onMessage.addListener((message: { type?: string; url?: string }, sender, sendResponse) => {
    if (message?.type !== "upwork:read-profile") return false;
    void readProfile(String(message.url ?? ""), sender.tab).then(sendResponse);
    return true;
  });
}

export async function readProfile(link: string, beside?: chrome.tabs.Tab): Promise<ProfileRead> {
  const url = profileLink(link);
  if (!url) return { ok: false, reason: "not-a-profile" };

  const deadline = Date.now() + TOTAL_MS;
  const tab = await chrome.tabs.create({
    url,
    active: false,
    windowId: beside?.windowId,
    index: beside ? beside.index + 1 : undefined,
  });
  const tabId = tab.id;
  if (tabId === undefined) return { ok: false, reason: "unreadable" };

  try {
    await loaded(tabId);
    const first = await readTab(tabId);
    if (!first) return { ok: false, reason: "unreadable" };
    const path = new URL(first.url).pathname;
    if (SIGN_IN_PATH.test(path)) return { ok: false, reason: "signed-out" };
    if (BOT_CHECK.test(first.text) && first.text.length < 3000) return { ok: false, reason: "blocked" };
    if (!PROFILE_PATH.test(path)) return { ok: false, reason: "not-a-profile" };
    if (first.text.length < 200) return { ok: false, reason: "unreadable" };

    const views: ProfileView[] = [view(first)];
    for (const next of first.links.slice(0, MAX_VIEWS - 1)) {
      if (Date.now() > deadline) break;
      await loaded(tabId, () => chrome.tabs.update(tabId, { url: next }));
      const page = await readTab(tabId);
      // A link that turned out to show a page already read adds nothing.
      if (page && page.text.length >= 200 && !views.some((v) => v.text === page.text)) views.push(view(page));
    }
    return { ok: true, views };
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

function view({ url, title, text }: PageRead): ProfileView {
  return { url, title, text };
}

/**
 * Resolves once the tab's page has loaded, or after LOAD_MS regardless. With
 * `navigate`, only a load that starts after it counts: right after an update
 * the tab still reports the page it is leaving as complete.
 */
function loaded(tabId: number, navigate?: () => Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    let started = !navigate;
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id: number, change: { status?: string }) => {
      if (id !== tabId) return;
      if (change.status === "loading") started = true;
      else if (change.status === "complete" && started) done();
    };
    const timer = setTimeout(done, LOAD_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    if (navigate) {
      navigate().catch(done);
    } else {
      // A new tab that finished before the listener was added sends no more events.
      void chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === "complete" && tab.url?.startsWith("http")) done();
      }, done);
    }
  });
}

async function readTab(tabId: number): Promise<PageRead | null> {
  try {
    const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage, args: [SETTLE_MS] });
    return (frame?.result as PageRead | undefined) ?? null;
  } catch {
    // The tab was closed, or shows a page no extension may read (a browser error page).
    return null;
  }
}

/**
 * The page's visible text once it stops changing, with "more" toggles opened
 * first, and the other views of this freelancer it links to.
 *
 * Injected with `executeScript`, so it is self-contained: nothing from module
 * scope. It runs in a tab this file opened for the read, never in one the
 * user is using, so expanding text there is safe.
 */
function readPage(settleMs: number): Promise<PageRead> {
  const MORE = /^(show|see|read|view)?\s*more$/i;
  const root = () => document.querySelector("main") ?? document.body;
  // Blank lines are kept (one at most): they are an overview's paragraphs.
  const textOf = (el: Element) =>
    ((el as HTMLElement).innerText ?? el.textContent ?? "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const expand = () => {
    for (const el of root().querySelectorAll<HTMLElement>("button, [role='button']")) {
      if (!el.closest("a[href]") && MORE.test((el.textContent ?? "").trim())) el.click();
    }
  };

  const collect = (): PageRead => {
    const here = location.pathname.replace(/\/+$/, "").toLowerCase();
    const self = location.href.split("#")[0];
    const links = new Set<string>();
    for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      try {
        const url = new URL(a.href);
        url.hash = "";
        const href = url.toString();
        if (url.hostname.endsWith("upwork.com") && url.pathname.replace(/\/+$/, "").toLowerCase() === here && href !== self) {
          links.add(href);
        }
      } catch {
        // Not a URL.
      }
    }
    return { url: location.href, title: document.title || null, text: textOf(root()).slice(0, 40_000), links: [...links] };
  };

  return new Promise((resolve) => {
    const started = Date.now();
    let last = -1;
    let steady = 0;
    let expanded = false;
    const tick = () => {
      const length = textOf(root()).length;
      steady = length > 200 && length === last ? steady + 1 : 0;
      last = length;
      if (steady >= 2 || Date.now() - started > settleMs) {
        if (expanded) return resolve(collect());
        expanded = true;
        expand();
        steady = 0;
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}
