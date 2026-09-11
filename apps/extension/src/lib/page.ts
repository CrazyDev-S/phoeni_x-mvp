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
import type { FillResult, JobExtract, ScanResult } from "./types";

export interface TargetTab {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
}

/** The panel is not a tab, so pin the window once and track within it. */
export async function activeTab(windowId: number): Promise<TargetTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab?.id || !tab.url) return null;
  return { tabId: tab.id, windowId, url: tab.url, title: tab.title ?? "" };
}

export function isInjectable(url: string): boolean {
  return /^https?:/.test(url);
}

async function runInFrames<T>(
  tabId: number,
  files: string[],
  fn: (...args: never[]) => T,
  args: unknown[] = [],
): Promise<{ result?: Awaited<T> }[]> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files,
    world: "ISOLATED",
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "ISOLATED",
    func: fn as never,
    args: args as never[],
  });
  return results as { result?: Awaited<T> }[];
}

export async function extractJob(tabId: number): Promise<JobExtract | null> {
  const results = await runInFrames(tabId, ["scan.js"], () =>
    (window as unknown as { __raScan: { extractJob(): JobExtract } }).__raScan.extractJob(),
  );
  // The main frame is always first; prefer whichever frame has the most text.
  const candidates = results
    .map((r) => r.result)
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

export async function scanForms(tabId: number): Promise<ScanSummary> {
  const results = await runInFrames(
    tabId,
    ["scan.js"],
    (index: number) =>
      (window as unknown as { __raScan: { scanFrame(k: string): ScanResult } }).__raScan.scanFrame(
        `f${index}`,
      ),
    [0],
  );

  const frames: ScanResult[] = [];
  results.forEach((r, i) => {
    if (!r.result) return;
    // frameKey must be unique per frame; the injected call cannot know its own
    // index, so stamp it here where we can see the whole result set.
    const frame = { ...r.result, frameKey: `f${i}` };
    frame.fields = frame.fields.map((f) => ({ ...f, id: f.id.replace(/^f\d+:/, `f${i}:`) }));
    frames.push(frame);
  });

  // Reconcile: if the top frame sees iframes we did not get results for, we
  // could not inject into them — usually a missing host permission or a
  // sandboxed frame. Say so rather than silently under-filling.
  const top = frames[0];
  const reached = frames.length - 1;
  const unreachable =
    top && top.iframeCount > reached ? top.iframeSrcs.slice(0, 5) : [];

  return { frames: frames.filter((f) => f.fields.length > 0), unreachableFrames: unreachable };
}

export async function fillForms(
  tabId: number,
  frameKeyToInstructions: Record<string, unknown[]>,
): Promise<FillResult[]> {
  const results = await runInFrames(
    tabId,
    ["fill.js"],
    (map: Record<string, unknown[]>) => {
      const win = window as unknown as {
        __raFill: { fillAll(steps: unknown[]): Promise<FillResult[]> };
        __raRegistry?: Map<string, Element>;
      };
      // Each frame only fills instructions addressed to the fields it owns.
      const mine = Object.entries(map).find(([key]) =>
        Array.from(win.__raRegistry?.keys() ?? []).some((id) => id.startsWith(`${key}:`)),
      );
      return mine ? win.__raFill.fillAll(mine[1]) : Promise.resolve([]);
    },
    [frameKeyToInstructions],
  );
  return results.flatMap((r) => r.result ?? []);
}
