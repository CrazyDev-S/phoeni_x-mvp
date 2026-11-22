import { ExternalLink, Pause, Play, Radar, RefreshCw, Timer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  UPWORK_CHECK_MS,
  UPWORK_CONTENT_SCRIPT,
  UPWORK_PAUSED_KEY,
  UPWORK_STATS_KEY,
  UPWORK_TAB_PREFIX,
} from "@/lib/constants";
import { postingIn } from "@/lib/upwork";
import { emptyStats, type UpworkStats, type UpworkTabState } from "@/lib/upwork-capture";
import { cn } from "@/lib/utils";
import { Section } from "../chrome-shell";
import { ErrorNote } from "../components";
import { ago, PostingView } from "./upwork/Posting";

const UPWORK_HOME = "https://www.upwork.com/nx/find-work/";

function onUpwork(url: string | undefined): boolean {
  return Boolean(url && /^https:\/\/www\.upwork\.com\//.test(url));
}

/** The active tab of the panel's own window, kept current as the user moves around. */
function useActiveTab() {
  const [tab, setTab] = useState<{ id: number; url: string } | null>(null);
  useEffect(() => {
    let windowId: number | undefined;
    const refresh = async () => {
      if (windowId === undefined) return;
      const [active] = await chrome.tabs.query({ active: true, windowId });
      setTab(active?.id !== undefined ? { id: active.id, url: active.url ?? "" } : null);
    };
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.url || change.status === "complete") void refresh();
    };
    void chrome.windows.getCurrent().then((w) => {
      windowId = w.id;
      void refresh();
    });
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function lastResult(check: NonNullable<UpworkTabState["lastCheck"]>): string {
  if (check.added === null) return "not saved";
  return check.added ? `${check.added} new to the team` : "nothing new";
}

/** This tab is refreshed every few minutes while it shows a list: when next, and what the last one brought in. */
function NextCheck({ state, paused, checking }: { state: UpworkTabState; paused: boolean; checking: boolean }) {
  const now = useNow(1000);
  if (!state.nextCheck) return null;
  const left = Math.max(0, Date.parse(state.nextCheck) - now);
  const due = checking || left === 0;
  const clock = `${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
  const filled = due ? 1 : Math.min(1, Math.max(0, 1 - left / UPWORK_CHECK_MS));

  return (
    <div className="space-y-1.5 border-t pt-2">
      <div className="flex items-center gap-2 text-[11px]">
        {due && !paused ? <RefreshCw className="text-primary size-3.5 animate-spin" /> : <Timer className="text-muted-foreground size-3.5" />}
        <span className="min-w-0 flex-1 truncate">
          {paused ? "Auto-refresh paused" : due ? "Refreshing…" : `Refreshes every ${UPWORK_CHECK_MS / 60_000} min`}
        </span>
        {!paused && !due && <span className="text-muted-foreground font-medium tabular-nums">{clock}</span>}
      </div>
      {!paused && (
        <div className="bg-muted h-0.5 overflow-hidden rounded-full">
          <div className="bg-primary h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${filled * 100}%` }} />
        </div>
      )}
      {state.lastCheck && (
        <p className="text-muted-foreground text-[11px]">
          Last refresh {ago(state.lastCheck.at)}: {lastResult(state.lastCheck)}
        </p>
      )}
    </div>
  );
}

/**
 * Upwork capture, seen from the panel. Collecting happens without it - the
 * content script reads every Upwork page as it changes, and refreshes a list
 * left open every few minutes - so this is the dashboard: on or paused, what
 * this page holds, when it next refreshes, and what went in today. With one
 * posting open it is about that posting alone (`upwork/Posting`): who posted
 * it, who is viewing it, and its proposal.
 */
export function UpworkTab({ portalUrl }: { portalUrl: string }) {
  const tab = useActiveTab();
  const [stats, setStats] = useState<UpworkStats>(emptyStats());
  const [paused, setPaused] = useState(false);
  const [page, setPage] = useState<UpworkTabState | null>(null);
  const [reading, setReading] = useState(false);
  const tabKey = tab ? `${UPWORK_TAB_PREFIX}${tab.id}` : null;

  useEffect(() => {
    void chrome.storage.local.get([UPWORK_STATS_KEY, UPWORK_PAUSED_KEY]).then((s) => {
      const stored = s[UPWORK_STATS_KEY] as UpworkStats | undefined;
      if (stored) setStats(stored);
      setPaused(Boolean(s[UPWORK_PAUSED_KEY]));
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[UPWORK_STATS_KEY]) setStats(changes[UPWORK_STATS_KEY].newValue as UpworkStats);
      if (area === "local" && changes[UPWORK_PAUSED_KEY]) setPaused(Boolean(changes[UPWORK_PAUSED_KEY].newValue));
      if (area === "session" && tabKey && changes[tabKey]) setPage((changes[tabKey].newValue as UpworkTabState) ?? null);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [tabKey]);

  useEffect(() => {
    setPage(null);
    if (!tabKey) return;
    void chrome.storage.session.get(tabKey).then((s) => setPage((s[tabKey] as UpworkTabState | undefined) ?? null));
  }, [tabKey]);

  const readAgain = useCallback(async () => {
    if (!tab) return;
    setReading(true);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "upwork:rescan" });
    } catch {
      // Opened before the extension was installed or updated: no reader yet.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [UPWORK_CONTENT_SCRIPT] }).catch(() => undefined);
    } finally {
      setTimeout(() => setReading(false), 600);
    }
  }, [tab]);

  const togglePause = async () => {
    await chrome.storage.local.set({ [UPWORK_PAUSED_KEY]: !paused });
    // Resuming sends what the page held back while paused.
    if (paused) void readAgain();
  };

  const today = new Date().toLocaleDateString("en-CA");
  const collected = stats.day === today ? stats.keys.length : 0;
  const added = stats.day === today ? stats.added : 0;
  const known = new Set(stats.keys);
  // The page reports itself on every change, navigation included.
  const onThisPage = onUpwork(tab?.url) ? page : null;
  const inList = onThisPage ? onThisPage.keys.filter((key) => known.has(key)).length : 0;
  const againLabel = onThisPage?.nextCheck ? "Refresh this page now" : "Read this page again";
  const posting = postingIn(tab?.url);

  const toggle = (
    <Button size="xs" variant="ghost" onClick={() => void togglePause()} aria-pressed={paused}>
      <span className="relative flex size-2">
        {!paused && <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60" />}
        <span className={cn("relative inline-flex size-2 rounded-full", paused ? "bg-muted-foreground/50" : "bg-success")} />
      </span>
      {paused ? "Paused" : "Collecting"}
      {paused ? <Play /> : <Pause />}
    </Button>
  );
  const problem = stats.error && !paused ? <ErrorNote>{stats.error}</ErrorNote> : null;

  // One posting open: that posting alone, not the page tally or today's history.
  if (posting && tab) {
    return (
      <div className="space-y-4">
        <PostingView
          key={posting}
          postingKey={posting}
          url={tab.url}
          tabState={onThisPage}
          paused={paused}
          portalUrl={portalUrl}
          action={toggle}
          problem={problem}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="Upwork" action={toggle}>
        <Card className="py-0">
          <CardContent className="space-y-2 p-3">
            {!onUpwork(tab?.url) ? (
              <>
                <p className="text-xs leading-relaxed">
                  Browse Upwork and every posting you scroll past or open joins the team&apos;s shared job list. A search
                  left open is refreshed every {UPWORK_CHECK_MS / 60_000} minutes.
                </p>
                <Button asChild size="sm" variant="brand" className="w-full">
                  <a href={UPWORK_HOME} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Open Upwork
                  </a>
                </Button>
              </>
            ) : !onThisPage || onThisPage.keys.length === 0 ? (
              <div className="flex items-center gap-2">
                <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-relaxed">
                  No postings read on this page. Open a search, your feed, or a job.
                </p>
                <Button size="icon-sm" variant="outline" onClick={() => void readAgain()} aria-label={againLabel} title={againLabel} disabled={reading}>
                  <RefreshCw className={cn(reading && "animate-spin")} />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none font-semibold tabular-nums">{onThisPage.keys.length}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {onThisPage.keys.length === 1 ? "posting" : "postings"} on this page
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {paused ? "Paused - not sent" : inList === onThisPage.keys.length ? "All in the shared list" : `${inList} in the shared list so far`}
                  </p>
                </div>
                <Button size="icon-sm" variant="outline" onClick={() => void readAgain()} aria-label={againLabel} title={againLabel} disabled={reading}>
                  <RefreshCw className={cn(reading && "animate-spin")} />
                </Button>
              </div>
            )}
            {onThisPage && <NextCheck state={onThisPage} paused={paused} checking={reading} />}
          </CardContent>
        </Card>

        {problem}
      </Section>

      <Section
        title="Today"
        action={
          <a
            href={`${portalUrl}/freelancing/jobs`}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
          >
            Shared list
            <ExternalLink className="size-3" />
          </a>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <Card className="py-0">
            <CardContent className="p-3">
              <p className="text-lg leading-none font-semibold tabular-nums">{collected}</p>
              <p className="text-muted-foreground mt-1 text-[11px]">collected</p>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-3">
              <p className="text-lg leading-none font-semibold tabular-nums">{added}</p>
              <p className="text-muted-foreground mt-1 text-[11px]">new to the team</p>
            </CardContent>
          </Card>
        </div>

        {stats.recent.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-[11px]">
            <Radar className="size-4 shrink-0" />
            Postings you collect show up here.
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {stats.recent.map((job) => (
              <li key={job.upwork_id}>
                <a
                  href={`${portalUrl}/freelancing/jobs/${job.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:bg-muted/50 flex items-center gap-2 px-3 py-2 transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate text-xs" title={job.title}>
                    {job.title}
                  </span>
                  {job.created && <Badge className="bg-success/10 text-success shrink-0">New</Badge>}
                  <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">{ago(job.at)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
