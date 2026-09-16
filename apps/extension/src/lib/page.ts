/**
 * Talking to the page.
 *
 * `chrome.scripting.executeScript` IS the panel↔page RPC: it serialises the
 * function, injects it, awaits the returned promise and hands back the value.
 * So there is no service-worker relay and no long-lived port.
 *
 * Note the closure caveat — a function passed as `func` loses its closure, so
 * anything it needs must arrive through `args` or be inlined.
 */
import type { FillResult, FillStep, FrameScan, JobExtract, ScanResult } from "./types";

export interface TargetTab {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl: string;
  active: boolean;
}

/** Every tab in a window. The panel is not a tab, so the window is pinned once. */
export async function windowTabs(windowId: number): Promise<TargetTab[]> {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.flatMap((tab) =>
    tab.id === undefined || !tab.url
      ? []
      : [
          {
            tabId: tab.id,
            windowId,
            url: tab.url,
            title: tab.title ?? "",
            favIconUrl: tab.favIconUrl ?? "",
            active: Boolean(tab.active),
          },
        ],
  );
}

export function isInjectable(url: string): boolean {
  return /^https?:/.test(url);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // A chrome:// or file:// URL, which is not injectable anyway.
    return url;
  }
}

const JOB_BOARDS =
  /greenhouse\.io|lever\.co|ashbyhq\.com|myworkday(jobs)?\.com|smartrecruiters\.com|workable\.com|icims\.com|jobvite\.com|bamboohr\.com|recruitee\.com|breezy\.hr|teamtailor\.com|rippling\.com|wellfound\.com|linkedin\.com\/jobs|indeed\.com/i;
const JOB_PATHS = /\/(jobs?|careers?|positions?|openings?|vacanc\w*|postings?)(\/|$|\?)|[?&](gh_jid|jobid|job_id|currentjobid)=/i;

/** A guess, for which tabs to select by default. The user has the last word. */
export function looksLikePosting(url: string): boolean {
  return JOB_BOARDS.test(url) || JOB_PATHS.test(url);
}

export async function focusTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
}

/**
 * A tab Chrome discarded to save memory, one restored from a previous session
 * but never opened, or one still loading has no document to inject into.
 * Tailoring many background tabs hits all three.
 */
export async function wake(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.discarded && tab.status === "complete") return;
  const asleep = tab.discarded || tab.status === "unloaded";
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id: number, change: { status?: string }) => {
      if (id === tabId && change.status === "complete") finish();
    };
    const timer = setTimeout(finish, 30_000);
    chrome.tabs.onUpdated.addListener(listener);
    if (asleep) void chrome.tabs.reload(tabId);
  });
}

/** Load a page script into every frame it can reach. Returns their frame ids. */
async function injectEverywhere(tabId: number, file: string): Promise<number[]> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [file],
    world: "ISOLATED",
  });
  return injected.map((r) => r.frameId);
}

async function runInFrame<T>(
  tabId: number,
  frameId: number,
  fn: (...args: never[]) => T,
  args: unknown[] = [],
): Promise<Awaited<T> | undefined> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: "ISOLATED",
    func: fn as never,
    args: args as never[],
  });
  return injection?.result as Awaited<T> | undefined;
}

export async function extractJob(tabId: number): Promise<JobExtract | null> {
  await wake(tabId);
  await injectEverywhere(tabId, "scan.js");
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "ISOLATED",
    func: () =>
      (window as unknown as { __raScan: { extractJob(): JobExtract } }).__raScan.extractJob(),
  });
  // The main frame is always first; prefer whichever frame has the most text.
  const candidates = results
    .map((r) => r.result as JobExtract | undefined)
    .filter((r): r is JobExtract => Boolean(r?.description_text));
  if (!candidates.length) return null;
  return candidates.sort(
    (a, b) => b.description_text.length - a.description_text.length,
  )[0];
}

export interface ScanSummary {
  frames: ScanResult[];
  /** iframes the page contains but we could not inject into. */
  unreachableFrames: string[];
}

/**
 * Scan every frame, each under its own key.
 *
 * Field ids are "f<frameId>:<index>", so every answer says which frame to fill
 * it in. Every frame used to be scanned as "f0" and renamed afterwards only in
 * the panel's copy - so a form inside an iframe, Greenhouse's embed above all,
 * was filled against the wrong frame's fields and nothing in it filled.
 */
export async function scanForms(tabId: number): Promise<ScanSummary> {
  await wake(tabId);
  const frameIds = await injectEverywhere(tabId, "scan.js");
  const scans = await Promise.all(
    frameIds.map(async (frameId): Promise<ScanResult | null> => {
      const scan = await runInFrame(
        tabId,
        frameId,
        (key: string) =>
          (window as unknown as { __raScan: { scanFrame(k: string): FrameScan } }).__raScan.scanFrame(
            key,
          ),
        [`f${frameId}`],
      ).catch(() => undefined);
      return scan ? { ...scan, frameId } : null;
    }),
  );
  const frames = scans.filter((s): s is ScanResult => s !== null);

  // Reconcile: if the top frame sees iframes we did not get results for, we
  // could not inject into them — usually a missing host permission or a
  // sandboxed frame. Say so rather than silently under-filling.
  const top = frames.find((f) => f.frameId === 0);
  const unreachable =
    top && top.iframeCount > frames.length - 1 ? top.iframeSrcs.slice(0, 5) : [];

  return { frames: frames.filter((f) => f.fields.length > 0), unreachableFrames: unreachable };
}

/** The frame a field lives in, from its "f<frameId>:<index>" id. */
export function frameOf(fieldId: string): number {
  return Number(fieldId.slice(1, fieldId.indexOf(":")));
}

export async function fillForms(tabId: number, steps: FillStep[]): Promise<FillResult[]> {
  const byFrame = new Map<number, FillStep[]>();
  for (const step of steps) {
    const frameId = frameOf(step.id);
    byFrame.set(frameId, [...(byFrame.get(frameId) ?? []), step]);
  }

  const results: FillResult[] = [];
  // A frame at a time, in page order, so a form split across frames still
  // fills top to bottom.
  for (const [frameId, frameSteps] of byFrame) {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["fill.js"],
      world: "ISOLATED",
    });
    const filled = await runInFrame(
      tabId,
      frameId,
      (s: FillStep[]) =>
        (window as unknown as {
          __raFill: { fillAll(steps: FillStep[]): Promise<FillResult[]> };
        }).__raFill.fillAll(s),
      [frameSteps],
    );
    results.push(...(filled ?? []));
  }
  return results;
}
