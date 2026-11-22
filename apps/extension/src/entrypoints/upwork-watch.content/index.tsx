/**
 * Client watch. While a posting is open on Upwork - its own page or the
 * slide-over a search opens - this keeps PhoeniX watching its client and shows
 * a small card with what they are doing.
 *
 * The loop is the whole job: read the open page once, then every ~2 minutes
 * either refresh (alerts on: a hidden reload of the posting, so a client visit
 * or a new interview is seen as it happens) or just say "still here" (alerts
 * off: a teammate relays it, so this browser asks Upwork for nothing). The
 * background does the reading and the talking; see `lib/upwork-watch.ts`.
 */
import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";

import { jobKeyOf } from "@/lib/upwork-store";
import type { ReadMode, TabMessage, WatchMessage, WatchReply, WatchState } from "@/lib/upwork-watch";

import { Card, type View } from "./Card";
import css from "./card.css?raw";

const REFRESH_MS = 110_000;
// Jitter, so a watch is never a perfectly regular beat.
const REFRESH_JITTER_MS = 20_000;
const HEARTBEAT_MS = 120_000;
const RETRY_MS = 15_000;
const SIGNED_OUT_RETRY_MS = 60_000;

export default defineContentScript({
  matches: ["https://www.upwork.com/*"],
  runAt: "document_idle",
  // Styles go into the card's shadow root as text: no web-accessible resources.
  cssInjectionMode: "manual",

  async main(ctx) {
    let view: View | null = null;
    const subscribers = new Set<() => void>();
    const show = (next: View | null) => {
      view = next;
      subscribers.forEach((notify) => notify());
    };
    const subscribe = (notify: () => void) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    };

    let key: string | null = null;
    let state: WatchState | null = null;
    let timer: number | undefined;

    async function send(message: WatchMessage): Promise<WatchReply> {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch {
        return { ok: false, signedOut: false, error: "PhoeniX was updated. Reload this page to keep watching." };
      }
    }

    function apply(reply: WatchReply) {
      if (reply.ok) {
        state = reply.state;
        show({ kind: "watching", state });
      } else {
        show(state ? { kind: "watching", state, problem: reply.error } : { kind: "error", ...reply });
      }
    }

    function plan(reply: WatchReply) {
      clearTimeout(timer);
      const [read, wait]: [ReadMode, number] = !state
        ? ["page", !reply.ok && reply.signedOut ? SIGNED_OUT_RETRY_MS : RETRY_MS]
        : state.notify
          ? ["fresh", REFRESH_MS + Math.random() * REFRESH_JITTER_MS]
          : ["none", HEARTBEAT_MS];
      timer = ctx.setTimeout(() => void look(read), wait);
    }

    async function look(read: ReadMode) {
      const mine = key;
      if (!mine) return;
      clearTimeout(timer);
      if (read === "fresh" && state) show({ kind: "watching", state, refreshing: true });
      const reply = await send({ type: "watch:report", key: mine, url: location.href, read });
      if (key !== mine) return; // the tab moved on while this was out
      apply(reply);
      plan(reply);
    }

    async function setNotify(notify: boolean) {
      const mine = key;
      if (!mine || !state) return;
      const reply = await send({ type: "watch:notify", key: mine, jobId: state.job_id, notify });
      if (key !== mine) return;
      apply(reply);
      // Turned on: see the client now rather than in two minutes.
      if (reply.ok && notify) void look("fresh");
      else plan(reply);
    }

    function follow() {
      const next = jobKeyOf(location.href);
      if (next === key) return;
      clearTimeout(timer);
      key = next;
      state = null;
      show(key ? { kind: "loading" } : null);
      if (key) void look("page");
    }

    function App() {
      const current = useSyncExternalStore(subscribe, () => view);
      return current ? <Card view={current} onNotify={setNotify} /> : null;
    }

    const ui = await createShadowRootUi<Root>(ctx, {
      name: "phoenix-client-watch",
      position: "inline",
      anchor: "body",
      append: "last",
      css,
      isolateEvents: true,
      onMount(container) {
        const root = createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();

    // Another tab of this browser changed the alerts for the same posting.
    chrome.runtime.onMessage.addListener((message: TabMessage) => {
      if (message?.type === "watch:state" && message.key === key) {
        const reply: WatchReply = { ok: true, state: message.state };
        apply(reply);
        plan(reply);
      }
      return false;
    });
    // Upwork navigates in-app: a slide-over opening or closing is a URL change.
    ctx.addEventListener(window, "wxt:locationchange", follow);
    follow();
  },
});
