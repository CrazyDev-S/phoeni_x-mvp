import { useEffect, useRef, useState } from "react";

import { api, downloadDocx, waitForGeneration } from "@/lib/api";
import { BASE_RESUME_KEY } from "@/lib/constants";
import { activeTab, extractJob, fillForms, isInjectable, scanForms, type TargetTab } from "@/lib/page";
import type { FillResult, JobExtract, ScanResult } from "@/lib/types";
import { Err, Field, Progress } from "../components";

interface Resume { id: string; display_name: string }

interface Answer {
  id: string;
  type: string;
  answer: string;
  checked?: boolean;
  needs_user_input: boolean;
  reason: string;
  matched_fuzzily: boolean;
}

export function ApplyTab() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [baseId, setBaseId] = useState("");
  const [target, setTarget] = useState<TargetTab | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The operation is FROZEN against the tab it started on. Switching tabs
  // mid-run must not retarget a 90-second generation.
  const lockedTab = useRef<TargetTab | null>(null);

  const [phase, setPhase] = useState<{ label: string; pct: number } | null>(null);
  const [tailored, setTailored] = useState<{ id: string; job: JobExtract } | null>(null);

  const [fillState, setFillState] = useState<{
    results: FillResult[];
    unanswered: Answer[];
    unreachable: string[];
  } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const win = await chrome.windows.getCurrent();
      const refresh = async () => {
        if (win.id === undefined) return;
        setTarget(await activeTab(win.id));
      };
      await refresh();

      const onActivated = (info: { windowId: number }) => {
        if (info.windowId === win.id) void refresh();
      };
      const onUpdated = (_id: number, change: { url?: string; status?: string }) => {
        if (change.url || change.status === "complete") void refresh();
      };
      chrome.tabs.onActivated.addListener(onActivated);
      chrome.tabs.onUpdated.addListener(onUpdated);

      const stored = (await chrome.storage.local.get(BASE_RESUME_KEY)) as Record<
        string,
        string | undefined
      >;
      const list = await api<{ items: Resume[] }>("/api/v1/resumes").catch(() => null);
      if (list) {
        setResumes(list.items);
        setBaseId(stored[BASE_RESUME_KEY] ?? list.items[0]?.id ?? "");
      }

      return () => {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };
    })();
  }, []);

  function chooseResume(id: string) {
    setBaseId(id);
    void chrome.storage.local.set({ [BASE_RESUME_KEY]: id });
  }

  async function tailor() {
    setError(null);
    setFillState(null);
    setSaved(false);
    const tab = target;
    if (!tab || !isInjectable(tab.url)) {
      setError("Open a job posting in this window first.");
      return;
    }
    lockedTab.current = tab;

    try {
      setPhase({ label: "Reading the page", pct: 5 });
      const job = await extractJob(tab.tabId);
      if (!job || job.description_text.length < 120) {
        setError("Could not find a job description on this page.");
        setPhase(null);
        return;
      }

      setPhase({ label: "Sending to your backend", pct: 12 });
      const accepted = await api<{
        id: string; reused?: boolean; result_id?: string | null;
      }>("/api/v1/extension/tailor", {
        method: "POST",
        body: JSON.stringify({ base_resume_id: baseId, job }),
      });

      let resultId = accepted.result_id ?? null;
      if (!accepted.reused) {
        const done = await waitForGeneration(accepted.id, (label, pct) =>
          setPhase({ label, pct }),
        );
        resultId = (done.result_id as string) ?? null;

        // A resume with a banned placeholder must never reach a real
        // application in one click - push the user into the editor instead.
        const findings = (done.findings as Array<{ rule_id: string; severity: string }>) ?? [];
        const blocking = findings.filter(
          (f) => f.severity === "error" &&
            (f.rule_id === "PLACEHOLDER_TOKEN" || f.rule_id === "DOSSIER_PROVENANCE"),
        );
        if (blocking.length) {
          setPhase(null);
          setError(
            `Held back: ${blocking[0].rule_id.toLowerCase().replace("_", " ")}. Open it in the portal and fix it before sending.`,
          );
          return;
        }
      } else {
        setPhase({ label: "Reused an identical recent run", pct: 100 });
      }

      if (!resultId) throw new Error("No result returned");

      setPhase({ label: "Downloading", pct: 96 });
      const name = `${job.company ?? "Resume"} - ${job.title ?? "Application"}.docx`;
      await downloadDocx({ resume_id: resultId, kind: "tailored", profile: "designed" }, name);

      setTailored({ id: resultId, job });
      setPhase({ label: "Downloaded to your Downloads folder", pct: 100 });
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
    }
  }

  async function fillBlanks() {
    setError(null);
    const tab = lockedTab.current ?? target;
    if (!tab) return;

    try {
      setPhase({ label: "Scanning the form", pct: 10 });
      const { frames, unreachableFrames } = await scanForms(tab.tabId);
      if (!frames.length) {
        setError(
          unreachableFrames.length
            ? "The form sits in a frame we cannot reach. Open it directly and try again."
            : "No fillable fields found on this page.",
        );
        setPhase(null);
        return;
      }

      setPhase({ label: "Working out the answers", pct: 40 });
      const job = tailored?.job ?? (await extractJob(tab.tabId));
      const response = await api<{ answers: Answer[]; unanswered: Answer[] }>(
        "/api/v1/extension/autofill",
        {
          method: "POST",
          body: JSON.stringify({
            base_resume_id: baseId,
            job: job ?? undefined,
            frames: frames.map((f: ScanResult) => ({
              frame_key: f.frameKey,
              url: f.url,
              fields: f.fields,
            })),
          }),
        },
      );

      setPhase({ label: "Filling the page", pct: 70 });
      const labels = new Map(
        frames.flatMap((f) => f.fields.map((x) => [x.id, x.label] as const)),
      );
      const grouped: Record<string, unknown[]> = {};
      for (const a of response.answers) {
        const key = a.id.split(":")[0];
        (grouped[key] ??= []).push({ ...a, label: labels.get(a.id) ?? "" });
      }
      const results = await fillForms(tab.tabId, grouped);

      setFillState({
        results,
        unanswered: response.unanswered.map((u) => ({
          ...u,
          reason: u.reason || "Needs you",
        })),
        unreachable: unreachableFrames,
      });
      setPhase(null);
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
    }
  }

  async function saveApplication() {
    if (!tailored) return;
    try {
      await api("/api/v1/extension/save-application", {
        method: "POST",
        body: JSON.stringify({
          tailored_resume_id: tailored.id,
          company_name: tailored.job.company ?? "Unknown company",
          role_title: tailored.job.title ?? "Unknown role",
          job_url: tailored.job.url,
          job_description_text: tailored.job.description_text.slice(0, 20_000),
          location: tailored.job.location,
        }),
      });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const filled = fillState?.results.filter((r) => r.status === "filled").length ?? 0;
  const needsYou = [
    ...(fillState?.results.filter((r) => r.status !== "filled") ?? []),
    ...(fillState?.unanswered ?? []),
  ];

  return (
    <>
      <div className="card">
        <div className="small muted truncate" title={target?.url}>
          {target && isInjectable(target.url)
            ? `Working against: ${target.title || target.url}`
            : "Open a job posting in this window"}
        </div>

        <Field label="Base resume">
          <select value={baseId} onChange={(e) => chooseResume(e.target.value)}>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>{r.display_name}</option>
            ))}
          </select>
        </Field>

        <button
          className="btn primary block"
          disabled={!baseId || !target || Boolean(phase && phase.pct < 100)}
          onClick={tailor}
        >
          Tailor &amp; download
        </button>

        <button
          className="btn block"
          style={{ marginTop: 6 }}
          disabled={!target || Boolean(phase && phase.pct < 100)}
          onClick={fillBlanks}
        >
          Fill the application form
        </button>

        {phase && (
          <div style={{ marginTop: 10 }}>
            <Progress label={phase.label} pct={phase.pct} />
          </div>
        )}
        {error && <div style={{ marginTop: 8 }}><Err>{error}</Err></div>}
      </div>

      {tailored && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong className="truncate">{tailored.job.title ?? "Tailored resume"}</strong>
            {saved && <span className="badge ok">Saved</span>}
          </div>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>
            {tailored.job.company ?? "Unknown company"}
            {tailored.job.ats && ` · ${tailored.job.ats}`}
          </p>
          <button className="btn block" disabled={saved} onClick={saveApplication}>
            {saved ? "Tracked" : "Save &amp; track this application"}
          </button>
        </div>
      )}

      {fillState && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>
              Filled {filled} of {fillState.results.length + fillState.unanswered.length}
            </strong>
            <button className="btn" onClick={fillBlanks}>Re-scan</button>
          </div>

          {fillState.unreachable.length > 0 && (
            <p className="small warn" style={{ marginTop: 6 }}>
              {fillState.unreachable.length} frame(s) could not be reached. If the form
              is embedded, open it directly:{" "}
              <a href={fillState.unreachable[0]} target="_blank" rel="noreferrer">
                open form
              </a>
            </p>
          )}

          {needsYou.length > 0 && (
            <>
              <p className="small muted" style={{ margin: "8px 0 4px" }}>
                {needsYou.length} need you — the answer is here, ready to copy:
              </p>
              <ul className="list small">
                {needsYou.map((item, i) => {
                  const answer =
                    "answer" in item ? String(item.answer ?? "") : String(item.intended ?? "");
                  const label = "label" in item ? item.label : "";
                  return (
                    <li key={i} style={{ padding: "6px 0" }}>
                      <div className="row">
                        <span className="truncate" style={{ flex: 1 }}>
                          {label || ("id" in item ? item.id : "")}
                        </span>
                        <span className={`badge ${"status" in item && item.status === "reverted" ? "warn" : "bad"}`}>
                          {"status" in item ? item.status : "needs you"}
                        </span>
                      </div>
                      {answer && (
                        <div className="row" style={{ marginTop: 3 }}>
                          <code className="truncate" style={{ flex: 1 }}>{answer}</code>
                          <button
                            className="btn"
                            style={{ padding: "2px 6px", fontSize: 11 }}
                            onClick={() => navigator.clipboard.writeText(answer)}
                          >
                            Copy
                          </button>
                        </div>
                      )}
                      {"reason" in item && item.reason && (
                        <div className="small muted">{item.reason}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button
                className="btn block"
                style={{ marginTop: 8 }}
                onClick={() =>
                  navigator.clipboard.writeText(
                    needsYou
                      .map((i) => {
                        const a = "answer" in i ? i.answer : (i as FillResult).intended;
                        const l = "label" in i ? i.label : (i as Answer).id;
                        return `${l}: ${a}`;
                      })
                      .join("\n"),
                  )
                }
              >
                Copy all as text
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
