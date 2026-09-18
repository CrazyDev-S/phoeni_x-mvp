import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, docxName, downloadDocx, waitForGeneration } from "@/lib/api";
import { extractJob, isInjectable, windowTabs, type TargetTab } from "@/lib/page";
import type { JobLink, ResumeRef } from "@/lib/types";

export type Strategy = "existing" | "full";

/** A tailoring run, as this panel sees it. */
export interface Run {
  label: string;
  percent: number;
  running: boolean;
  error: string | null;
}

export interface JobRow {
  tab: TargetTab;
  /** Null until the backend has been asked about the tab's posting. */
  link: JobLink | null;
  run: Run | null;
}

interface Accepted {
  id: string;
  reused?: boolean;
  result_id?: string | null;
}

const NO_RUN: Run = { label: "", percent: 0, running: false, error: null };
const IN_FLIGHT = new Set(["queued", "running"]);
const LOOKUP_BATCH = 60;
// A page load fires several tab events; one refresh per burst.
const REFRESH_DEBOUNCE_MS = 300;
// A resume breaking one of these must never reach a real application in one
// click - the user is sent to the editor instead.
const BLOCKING_RULES = new Set(["PLACEHOLDER_TOKEN", "DOSSIER_PROVENANCE"]);

/**
 * Every open tab in the panel's window, with its posting's resume and run.
 *
 * Runs are keyed by the posting (the backend's job key), not the tab: a run
 * started on a posting still shows once that tab moves on to the posting's
 * application form. The runs themselves live on the backend, so closing the
 * panel stops nothing - reopening it picks their progress back up.
 */
export function useJobBoard(portalUrl: string) {
  const [tabs, setTabs] = useState<TargetTab[]>([]);
  const [active, setActive] = useState<TargetTab | null>(null);
  const [links, setLinks] = useState<Record<string, JobLink>>({});
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const windowId = useRef<number | null>(null);
  const tabsRef = useRef<TargetTab[]>([]);
  // Generations already being polled, so no refresh polls one twice.
  const following = useRef(new Set<string>());

  const setRun = useCallback((key: string, patch: Partial<Run>) => {
    setRuns((all) => ({ ...all, [key]: { ...(all[key] ?? NO_RUN), ...patch } }));
  }, []);

  const lookup = useCallback(async (urls: string[]): Promise<JobLink[]> => {
    const unique = [...new Set(urls.filter(isInjectable))];
    const found: JobLink[] = [];
    for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
      const { items } = await api<{ items: JobLink[] }>("/api/v1/extension/job-links/lookup", {
        method: "POST",
        body: JSON.stringify({ urls: unique.slice(i, i + LOOKUP_BATCH) }),
      });
      found.push(...items);
    }
    setLinks((all) => {
      const next = { ...all };
      for (const link of found) next[link.url] = link;
      return next;
    });
    return found;
  }, []);

  const lookupAll = useCallback(
    () => lookup(tabsRef.current.map((t) => t.url)).catch(() => [] as JobLink[]),
    [lookup],
  );

  /** Wait out a generation, reporting its progress against a posting. */
  const follow = useCallback(
    async (key: string, generationId: string) => {
      following.current.add(generationId);
      setRun(key, { running: true, error: null, label: "Queued", percent: 2 });
      try {
        return await waitForGeneration(generationId, (label, percent) =>
          setRun(key, { label: label || "Tailoring", percent: Math.max(percent, 2) }),
        );
      } finally {
        following.current.delete(generationId);
      }
    },
    [setRun],
  );

  const refreshLinks = useCallback(async () => {
    const found = await lookupAll();
    // A run started before the panel was last closed is still going on the
    // backend: pick its progress back up.
    for (const link of found) {
      const generation = link.generation;
      if (!generation || !IN_FLIGHT.has(generation.status)) continue;
      if (following.current.has(generation.id)) continue;
      void follow(link.job_key, generation.id)
        .then(() => setRun(link.job_key, { running: false, label: "Tailored", percent: 100 }))
        .catch((e: Error) => setRun(link.job_key, { running: false, error: e.message }))
        .finally(() => void lookupAll());
    }
  }, [follow, lookupAll, setRun]);

  const refresh = useCallback(async () => {
    if (windowId.current === null) return;
    const all = await windowTabs(windowId.current);
    const pages = all.filter((t) => isInjectable(t.url) && !t.url.startsWith(portalUrl));
    const changed =
      pages.map((t) => t.url).join("\n") !== tabsRef.current.map((t) => t.url).join("\n");
    tabsRef.current = pages;
    setTabs(pages);
    setActive(all.find((t) => t.active) ?? null);
    if (changed && pages.length) await refreshLinks();
  }, [portalUrl, refreshLinks]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
    };
    const inWindow = (id: number) => id === windowId.current;
    const onActivated = (info: { windowId: number }) => inWindow(info.windowId) && soon();
    const onUpdated = (
      _id: number,
      change: { url?: string; status?: string; title?: string },
      tab: chrome.tabs.Tab,
    ) => inWindow(tab.windowId) && (change.url || change.title || change.status === "complete") && soon();
    const onRemoved = (_id: number, info: { windowId: number }) => inWindow(info.windowId) && soon();

    void chrome.windows.getCurrent().then((win) => {
      windowId.current = win.id ?? null;
      void refresh();
    });
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onAttached.addListener(soon);
    chrome.tabs.onDetached.addListener(soon);
    return () => {
      clearTimeout(timer);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onAttached.removeListener(soon);
      chrome.tabs.onDetached.removeListener(soon);
    };
  }, [refresh]);

  /** Tailor one tab's posting and download the result. Many can run at once. */
  const tailor = useCallback(
    async (tab: TargetTab, baseResumeId: string, strategy: Strategy) => {
      let key = tab.url;
      try {
        const [link] = await lookup([tab.url]);
        key = link?.job_key ?? tab.url;
        setRun(key, { running: true, error: null, label: "Reading the page", percent: 1 });
        const job = await extractJob(tab.tabId);
        if (!job || job.description_text.length < 120) {
          throw new Error("No job description on this page. Open the posting itself.");
        }

        setRun(key, { label: "Sending to your backend", percent: 2 });
        const accepted = await api<Accepted>("/api/v1/extension/tailor", {
          method: "POST",
          body: JSON.stringify({ base_resume_id: baseResumeId, job, strategy }),
        });

        let resultId = accepted.result_id ?? null;
        if (!accepted.reused) {
          // Claimed before the refresh below can see the run and poll it too.
          following.current.add(accepted.id);
          void refreshLinks();
          const done = await follow(key, accepted.id);
          resultId = (done.result_id as string | null | undefined) ?? null;
          const findings =
            (done.findings as { rule_id: string; severity: string }[] | undefined) ?? [];
          const blocking = findings.find(
            (f) => f.severity === "error" && BLOCKING_RULES.has(f.rule_id),
          );
          if (blocking) {
            throw new Error(
              `Held back: ${blocking.rule_id.toLowerCase().replace("_", " ")}. Fix it in the portal before sending.`,
            );
          }
        }
        if (!resultId) throw new Error("The run finished without a resume.");

        setRun(key, { label: "Downloading", percent: 98 });
        await downloadDocx(
          { resume_id: resultId, kind: "tailored", profile: "designed" },
          docxName(job.company, job.title),
        );
        setRun(key, {
          running: false,
          percent: 100,
          label: accepted.reused ? "Reused a recent run · downloaded" : "Downloaded",
        });
      } catch (e) {
        setRun(key, { running: false, error: (e as Error).message });
      } finally {
        void lookupAll();
      }
    },
    [follow, lookup, lookupAll, refreshLinks, setRun],
  );

  /** Use a resume for a tab's posting as it is, or unlink it with null. */
  const linkResume = useCallback(
    async (tab: TargetTab, resume: ResumeRef | null) => {
      // The posting is read too, so a form filled later has its description.
      const job = resume ? await extractJob(tab.tabId).catch(() => null) : null;
      await api("/api/v1/extension/job-links", {
        method: "PUT",
        body: JSON.stringify({
          url: tab.url,
          resume,
          job: job && job.description_text.length >= 120 ? job : null,
        }),
      });
      await lookupAll();
    },
    [lookupAll],
  );

  const download = useCallback(async (row: JobRow) => {
    const resume = row.link?.resume;
    if (!resume) return;
    await downloadDocx(
      { resume_id: resume.id, kind: resume.kind, profile: "designed" },
      docxName(
        row.link?.company_name ?? resume.company_name,
        row.link?.job_title ?? resume.job_title ?? resume.display_name,
      ),
    );
  }, []);

  const rows = useMemo<JobRow[]>(
    () =>
      tabs.map((tab) => {
        const link = links[tab.url] ?? null;
        return { tab, link, run: runs[link?.job_key ?? tab.url] ?? null };
      }),
    [tabs, links, runs],
  );

  const activeRow = useMemo<JobRow | null>(() => {
    if (!active) return null;
    return (
      rows.find((r) => r.tab.tabId === active.tabId) ?? {
        tab: active,
        link: links[active.url] ?? null,
        run: null,
      }
    );
  }, [active, rows, links]);

  return { rows, activeRow, tailor, linkResume, download, refresh: refreshLinks };
}
