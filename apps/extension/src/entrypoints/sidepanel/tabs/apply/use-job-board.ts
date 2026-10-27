import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  docxName,
  downloadDocx,
  stopGeneration,
  waitForGeneration,
  wasStopped,
} from "@/lib/api";
import { extractJob, isInjectable, windowTabs, type TargetTab } from "@/lib/page";
import type { JobLink, ResumeRef } from "@/lib/types";

/**
 * How Apply makes a posting's resume.
 *
 * generate: a new resume from the posting and the resume profile - the
 * portal's "From a job". tailor: the base resume reframed for the posting.
 */
export type Mode = "generate" | "tailor";

/** A generating or tailoring run, as this panel sees it. */
export interface Run {
  label: string;
  percent: number;
  running: boolean;
  /** Stop was pressed and the run has not wound down yet. */
  stopping: boolean;
  /** The last run was stopped; nothing was saved. */
  stopped: boolean;
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

const NO_RUN: Run = {
  label: "",
  percent: 0,
  running: false,
  stopping: false,
  stopped: false,
  error: null,
};
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
  // The generation behind each posting's run, so Stop can name it.
  const generations = useRef(new Map<string, string>());
  // Postings whose Stop was pressed before their run existed.
  const stopRequested = useRef(new Set<string>());

  const setRun = useCallback((key: string, patch: Partial<Run>) => {
    setRuns((all) => ({ ...all, [key]: { ...(all[key] ?? NO_RUN), ...patch } }));
  }, []);

  const lookup = useCallback(async (urls: string[]): Promise<JobLink[]> => {
    const unique = [...new Set(urls.filter(isInjectable))];
    const found: JobLink[] = [];
    for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
      const { items } = await api<{ items: JobLink[] }>("/api/v1/remote/extension/job-links/lookup", {
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
      generations.current.set(key, generationId);
      setRun(key, { running: true, error: null, label: "Queued", percent: 2 });
      // Stop was pressed while the page was still being read and sent.
      if (stopRequested.current.delete(key)) await stopGeneration(generationId).catch(() => {});
      try {
        return await waitForGeneration(generationId, (label, percent) =>
          setRun(key, { label: label || "Working", percent: Math.max(percent, 2) }),
        );
      } finally {
        following.current.delete(generationId);
        generations.current.delete(key);
      }
    },
    [setRun],
  );

  /** What a run's failure means to the row: a Stop is not an error. */
  const settle = useCallback(
    (key: string, e: unknown) =>
      setRun(
        key,
        wasStopped(e)
          ? { running: false, stopping: false, stopped: true, error: null, label: "Stopped" }
          : { running: false, stopping: false, error: (e as Error).message },
      ),
    [setRun],
  );

  /** Stop one posting's run. Many can be running; each stops on its own. */
  const stop = useCallback(
    async (key: string) => {
      setRun(key, { stopping: true });
      const id = generations.current.get(key);
      if (!id) {
        // Not on the backend yet: stopped as soon as it is.
        stopRequested.current.add(key);
        return;
      }
      try {
        await stopGeneration(id);
      } catch (e) {
        setRun(key, { stopping: false, error: (e as Error).message });
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
        .then(() => setRun(link.job_key, { running: false, label: "Finished", percent: 100 }))
        .catch((e: Error) => settle(link.job_key, e))
        .finally(() => void lookupAll());
    }
  }, [follow, lookupAll, settle, setRun]);

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

  /** Wait out a run, refuse a resume that must not be sent, and name its result. */
  const finish = useCallback(
    async (key: string, accepted: Accepted): Promise<string> => {
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
      return resultId;
    },
    [follow, refreshLinks],
  );

  /**
   * Generate a new resume from one tab's posting - the portal's "From a job" -
   * and download it. Many can run at once.
   *
   * It is a new base resume, built from the posting and the resume profile,
   * and it becomes the posting's resume (and its application's) in place of
   * any linked before: generating is the explicit way to get a new one.
   */
  const generate = useCallback(
    async (tab: TargetTab) => {
      let key = tab.url;
      try {
        const [link] = await lookup([tab.url]);
        key = link?.job_key ?? tab.url;
        stopRequested.current.delete(key);
        setRun(key, {
          running: true,
          stopping: false,
          stopped: false,
          error: null,
          label: "Reading the page",
          percent: 1,
        });
        const job = await extractJob(tab.tabId).catch(() => null);
        if (!job || job.description_text.length < 120) {
          throw new Error("No job description on this page. Open the posting itself.");
        }
        const title = (job.title || link?.job_title || tab.title || "").trim().slice(0, 160);
        if (title.length < 2) throw new Error("No job title on this page to generate for.");

        setRun(key, { label: "Sending to your backend", percent: 2 });
        const accepted = await api<Accepted>("/api/v1/remote/extension/generate", {
          method: "POST",
          body: JSON.stringify({
            target_title: title,
            job_description: job.description_text.slice(0, 60_000),
            // Links the new resume to this posting, and to its application.
            job_url: tab.url,
            job,
          }),
        });
        const resultId = await finish(key, accepted);

        setRun(key, { label: "Downloading", percent: 98 });
        await downloadDocx(
          { resume_id: resultId, kind: "base", profile: "designed" },
          docxName(job.company ?? link?.company_name ?? null, title),
        );
        setRun(key, { running: false, percent: 100, label: "Generated · downloaded" });
      } catch (e) {
        settle(key, e);
      } finally {
        void lookupAll();
      }
    },
    [finish, lookup, lookupAll, settle, setRun],
  );

  /**
   * Tailor one tab's posting and download the result. Many can run at once.
   *
   * A posting that already has a resume gets that resume rewritten in place,
   * not a new one - whatever links to it still does. Otherwise a new resume is
   * tailored from the chosen base resume.
   */
  const tailor = useCallback(
    async (tab: TargetTab, baseResumeId: string) => {
      let key = tab.url;
      try {
        const [link] = await lookup([tab.url]);
        key = link?.job_key ?? tab.url;
        const linked = link?.resume ?? null;
        stopRequested.current.delete(key);
        setRun(key, {
          running: true,
          stopping: false,
          stopped: false,
          error: null,
          label: "Reading the page",
          percent: 1,
        });
        const job = await extractJob(tab.tabId).catch(() => null);
        const readable = Boolean(job && job.description_text.length >= 120);
        // A linked resume can fall back on the posting read when it was linked.
        if (!readable && !linked) {
          throw new Error("No job description on this page. Open the posting itself.");
        }

        setRun(key, { label: "Sending to your backend", percent: 2 });
        const accepted = linked
          ? await api<Accepted>("/api/v1/remote/extension/job-links/upgrade", {
              method: "POST",
              body: JSON.stringify({
                url: tab.url,
                resume: { kind: linked.kind, id: linked.id },
                job: readable ? job : null,
              }),
            })
          : await api<Accepted>("/api/v1/remote/extension/tailor", {
              method: "POST",
              body: JSON.stringify({ base_resume_id: baseResumeId, job }),
            });

        const resultId = await finish(key, accepted);

        setRun(key, { label: "Downloading", percent: 98 });
        await downloadDocx(
          { resume_id: resultId, kind: linked?.kind ?? "tailored", profile: "designed" },
          docxName(
            job?.company ?? link?.company_name ?? null,
            job?.title ?? link?.job_title ?? linked?.display_name ?? null,
          ),
        );
        setRun(key, {
          running: false,
          percent: 100,
          label: accepted.reused ? "Reused a recent run · downloaded" : "Downloaded",
        });
      } catch (e) {
        settle(key, e);
      } finally {
        void lookupAll();
      }
    },
    [finish, lookup, lookupAll, settle, setRun],
  );

  /** Use a resume for a tab's posting as it is, or unlink it with null. */
  const linkResume = useCallback(
    async (tab: TargetTab, resume: ResumeRef | null) => {
      // The posting is read too, so a form filled later has its description.
      const job = resume ? await extractJob(tab.tabId).catch(() => null) : null;
      await api("/api/v1/remote/extension/job-links", {
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

  return { rows, activeRow, generate, tailor, stop, linkResume, download, refresh: refreshLinks };
}
