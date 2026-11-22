/**
 * Asking the PhoeniX extension for something from the portal. The extension
 * runs a small relay on the portal's own origin, so the page needs no
 * extension id: the two exchange window messages, and a page without the
 * extension simply hears nothing back.
 */

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

/** One page of a freelancer's Upwork profile, as the extension read it. */
export interface ProfileView {
  url: string;
  title: string | null;
  text: string;
}

export type ProfileRead =
  | { ok: true; views: ProfileView[] }
  | { ok: false; reason: "not-a-profile" | "signed-out" | "blocked" | "unreadable" };

// The relay answers "started" at once; silence this long means no extension.
const ANSWER_MS = 800;
// Each tab's refresh reports within 30 s, and the tabs refresh side by side.
const CHECK_MS = 45_000;
// The extension gives up reading more profile pages after 75 s.
const PROFILE_MS = 100_000;

type Asked<T> =
  | { kind: "done"; result: T }
  /** The extension heard the request but could not finish it. */
  | { kind: "failed" }
  /** No extension in this browser, or not set up for this portal's address. */
  | { kind: "absent" };

function ask<T>(type: string, payload: Record<string, unknown>, waitMs: number): Promise<Asked<T>> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    let timer: ReturnType<typeof setTimeout>;

    const done = (outcome: Asked<T>) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(outcome);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; id?: string; result?: T | null } | null;
      if (event.source !== window || data?.source !== "phoenix-extension" || data.id !== id) return;
      if (data.type === `${type}:started`) {
        clearTimeout(timer);
        timer = setTimeout(() => done({ kind: "failed" }), waitMs);
      } else if (data.type === `${type}:done`) {
        done(data.result ? { kind: "done", result: data.result } : { kind: "failed" });
      }
    };

    window.addEventListener("message", onMessage);
    timer = setTimeout(() => done({ kind: "absent" }), ANSWER_MS);
    window.postMessage({ source: "phoenix-portal", type, id, ...payload }, window.location.origin);
  });
}

export type UpworkCheckOutcome =
  | { kind: "checked"; result: UpworkCheckAll }
  | { kind: "failed" }
  | { kind: "absent" };

/** Refresh every Upwork search or feed open in this browser now, and tally what came in. */
export async function checkUpwork(): Promise<UpworkCheckOutcome> {
  const outcome = await ask<UpworkCheckAll>("upwork:check", {}, CHECK_MS);
  return outcome.kind === "done" ? { kind: "checked", result: outcome.result } : outcome;
}

/** Have the extension open a freelancer's Upwork profile in this browser and read its pages. */
export function readUpworkProfile(url: string): Promise<Asked<ProfileRead>> {
  return ask<ProfileRead>("upwork:profile", { url }, PROFILE_MS);
}
