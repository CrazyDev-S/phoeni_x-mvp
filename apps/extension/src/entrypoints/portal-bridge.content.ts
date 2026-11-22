/**
 * The portal's line to the extension. Registered at runtime for the portal URL
 * in Settings only (`lib/portal-bridge.ts`), so no other site can reach it, and
 * the page needs no extension id: the two talk in window messages.
 *
 * It relays the few requests in RELAYED, each the same way:
 *   page  -> { source: "phoenix-portal", type, id, ...payload }
 *   relay -> { source: "phoenix-extension", type: `${type}:started`, id }  at once
 *   relay -> { source: "phoenix-extension", type: `${type}:done`, id, result }  null when it failed
 *
 * "upwork:check" is the job list's Refresh; "upwork:profile" reads a
 * freelancer's Upwork profile for the profile form (`lib/upwork-profile.ts`).
 */

declare global {
  interface Window {
    __phoenixBridge?: boolean;
  }
}

type PortalRequest = { source?: string; type?: string; id?: string; url?: string };

// What the portal may ask, and the background message each request becomes.
const RELAYED: Record<string, (data: PortalRequest) => Record<string, unknown>> = {
  "upwork:check": () => ({ type: "upwork:check-all" }),
  "upwork:profile": (data) => ({ type: "upwork:read-profile", url: String(data.url ?? "") }),
};

export default defineContentScript({
  // Placeholder: the real match is the portal URL, registered at runtime.
  matches: ["http://127.0.0.1/*", "http://localhost/*"],
  registration: "runtime",
  main() {
    // Registered on load and also injected into portal tabs already open.
    if (window.__phoenixBridge) return;
    window.__phoenixBridge = true;

    window.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as PortalRequest | null;
      if (event.source !== window || data?.source !== "phoenix-portal" || !data.type) return;
      const toBackground = Object.hasOwn(RELAYED, data.type) ? RELAYED[data.type] : undefined;
      if (!toBackground) return;
      // A copy left behind by an extension reload has no one to talk to; the new copy answers.
      if (!chrome.runtime?.id) return;
      const post = (phase: "started" | "done", result?: unknown) =>
        window.postMessage({ source: "phoenix-extension", type: `${data.type}:${phase}`, id: data.id, result }, location.origin);
      post("started");
      chrome.runtime
        .sendMessage(toBackground(data))
        .then((result: unknown) => post("done", result ?? null))
        .catch(() => post("done", null));
    });
  },
});
