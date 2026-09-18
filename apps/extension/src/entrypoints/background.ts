/**
 * Service worker — deliberately tiny.
 *
 * MV3 service workers are evicted after ~30s idle, and a tailoring run takes
 * 60-180s. So NO network I/O lives here: all of it happens in the side panel,
 * which is a normal long-lived document. This inverts the usual "background
 * does the fetching" advice, and it is the single most important architectural
 * decision in the extension.
 *
 * What does live here: opening the panel (which needs a user gesture) and a
 * cheap alarm that keeps the toolbar badge current while the panel is closed.
 */
import { API_BASE_KEY, NEXT_CALL_KEY, TOKEN_KEY } from "@/lib/constants";

export default defineBackground(() => {
  const ALARM = "next-call";

  chrome.runtime.onInstalled.addListener(async () => {
    // Keep action.onClicked firing so we can scope the panel ourselves.
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    chrome.alarms.create(ALARM, { periodInMinutes: 5 });
    await refreshNextCall();
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(ALARM, { periodInMinutes: 5 });
  });

  chrome.action.onClicked.addListener(async (tab) => {
    // Scoped to the WINDOW, not the tab: the panel carries a calendar and a
    // banner, so it should persist across tab switches. A tabId-scoped panel
    // hides itself on tabs where it is not enabled.
    //
    // This must be called directly in the gesture handler - the user gesture
    // does not survive a runtime.sendMessage round trip.
    if (tab.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void refreshNextCall();
  });
});

async function refreshNextCall(): Promise<void> {
  try {
    const local = await chrome.storage.local.get([API_BASE_KEY, TOKEN_KEY]);
    const base = local[API_BASE_KEY];
    const token = local[TOKEN_KEY];
    if (!base || !token) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }

    const res = await fetch(`${base}/api/v1/meetings/next`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const next = await res.json();
    // storage.onChanged is the channel to the panel: idempotent, survives the
    // panel being closed, and needs no liveness handshake.
    await chrome.storage.local.set({ [NEXT_CALL_KEY]: next });

    if (!next) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    const mins = Number(next.starts_in_minutes ?? 0);
    const text = mins < 60 ? `${Math.max(mins, 0)}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : "";
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: mins < 60 ? "#b91c1c" : "#1f3864" });
  } catch {
    // A background refresh failing is not worth surfacing; the panel fetches
    // fresh data whenever it opens.
  }
}
