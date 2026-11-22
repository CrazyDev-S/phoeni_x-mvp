/**
 * Reading an Upwork posting the way Upwork's own app holds it.
 *
 * Upwork renders a posting from a Vue store (`jobDetails`): exact proposal and
 * interview counts, and `lastBuyerActivity` - the moment its client was last
 * on the posting. That store lives in the page's JS, so `readUpworkJob` runs in
 * the MAIN world: the one place in the extension that does, because the
 * ISOLATED world cannot see page globals. It reads, packs the posting and its
 * client, and returns; it never writes to the page.
 *
 * What the store *means* is the backend's business (`app.freelancing.capture`,
 * the "store" view): this file only finds it, so an Upwork rename is a server
 * fix, not a release. The text harvest of listings lives in `./upwork`.
 */

import { jobKey } from "./upwork";

/**
 * The posting a URL has open: its own page (`/jobs/...~key`) or the slide-over a
 * search or feed opens (`.../details/~key`). Null for every other page.
 */
export function jobKeyOf(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!/^\/jobs\//.test(path) && !/\/details\/~/.test(path)) return null;
  return jobKey(path);
}

/**
 * Upwork's store for the posting `key`, packed to plain JSON: `{job, buyer, sands}`.
 *
 * `fresh: false` reads the open page (no request to Upwork). `fresh: true`
 * loads the posting in a hidden frame of the same tab and reads that, which is
 * how a background refresh sees what changed since the page loaded; the frame
 * is removed as soon as it has been read.
 *
 * Injected through `chrome.scripting.executeScript({ world: "MAIN" })`, so it
 * must be self-contained: no imports, no closure, nothing from module scope.
 */
export function readUpworkJob(
  key: string,
  fresh: boolean,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  type Tree = Record<string, any>;
  const want = key.replace(/^~/, "").toLowerCase();
  const MAX_CHARS = 350_000;

  const storeOf = (win: any): Tree | null => {
    try {
      if (win.$nuxt?.$store?.state) return win.$nuxt.$store.state;
    } catch {}
    try {
      const root = win.document.querySelector("#__nuxt, #__layout, #app") as any;
      if (root?.__vue__?.$store?.state) return root.__vue__.$store.state;
    } catch {}
    return null;
  };

  // The jobDetails module, wherever this build of Upwork mounts it.
  const detailsIn = (root: unknown): Tree | null => {
    const queue: unknown[] = [root];
    const seen = new Set<unknown>();
    for (let steps = 0; queue.length && steps < 4000; steps++) {
      const node = queue.shift() as Tree;
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (node.jobDetails?.job) return node.jobDetails;
      for (const k in node) if (node[k] && typeof node[k] === "object") queue.push(node[k]);
    }
    return null;
  };

  const isThisPosting = (details: Tree | null): details is Tree => {
    const job = details?.job;
    const cipher = String(job?.ciphertext ?? job?.cipherText ?? "").replace(/^~/, "").toLowerCase();
    return cipher === want && job?.clientActivity?.totalApplicants !== undefined;
  };

  const read = (win: any): Tree | null => {
    // A page that just loaded has its server-rendered snapshot; a page that has
    // been navigated in-app has only its live store.
    const roots = fresh ? [win.__NUXT__, storeOf(win)] : [storeOf(win), win.__NUXT__];
    for (const root of roots) {
      const details = root ? detailsIn(root) : null;
      if (isThisPosting(details)) return details;
    }
    return null;
  };

  const pack = (details: Tree): Record<string, unknown> | null => {
    for (const keys of [["job", "buyer", "sands"], ["job", "buyer"]]) {
      const picked: Tree = {};
      for (const k of keys) if (details[k] != null) picked[k] = details[k];
      const seen = new WeakSet<object>();
      const json = JSON.stringify(picked, (_k, value) => {
        if (value && typeof value === "object") {
          if (seen.has(value)) return undefined;
          seen.add(value);
        }
        return value;
      });
      if (json.length <= MAX_CHARS) return JSON.parse(json);
    }
    return null;
  };

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let frame: HTMLIFrameElement | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let done = false;

    const finish = (value: Record<string, unknown> | null) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      frame?.remove();
      resolve(value);
    };
    const attempt = () => {
      try {
        const win = fresh ? frame?.contentWindow : window;
        const details = win ? read(win) : null;
        if (details) return finish(pack(details));
      } catch {
        // A frame Upwork refused to render same-origin cannot be read at all.
        if (fresh) return finish(null);
      }
      if (Date.now() > deadline) finish(null);
    };

    if (fresh) {
      frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText =
        "position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;opacity:0;border:0;pointer-events:none";
      // Background tabs throttle timers; the load event still fires on time.
      frame.addEventListener("load", attempt);
      frame.src = `${location.origin}/jobs/${key}`;
      (document.body ?? document.documentElement).appendChild(frame);
    }
    timer = setInterval(attempt, 300);
    attempt();
  });
}
