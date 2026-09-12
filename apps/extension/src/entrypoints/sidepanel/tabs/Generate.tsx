import { useEffect, useState } from "react";

import { api, downloadDocx, waitForGeneration } from "@/lib/api";
import { DRAFT_KEY } from "@/lib/constants";
import { ErrorNote, Field, Progress } from "../components";

/**
 * Generate a new resume without leaving the browser.
 *
 * Draft state is persisted on every change: the panel document is destroyed
 * whenever the panel closes, so anything held only in React state is lost.
 */
interface Draft {
  title?: string;
  skills?: string;
  notes?: string;
  jd?: string;
  useJd?: boolean;
}

export function GenerateTab() {
  const [title, setTitle] = useState("");
  const [skills, setSkills] = useState("");
  const [notes, setNotes] = useState("");
  const [jd, setJd] = useState("");
  const [useJd, setUseJd] = useState(false);
  const [phase, setPhase] = useState<{ label: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  useEffect(() => {
    void chrome.storage.local.get(DRAFT_KEY).then((s) => {
      const d = (s as Record<string, Draft | undefined>)[DRAFT_KEY];
      if (!d) return;
      setTitle(d.title ?? "");
      setSkills(d.skills ?? "");
      setNotes(d.notes ?? "");
      setJd(d.jd ?? "");
      setUseJd(Boolean(d.useJd));
    });
  }, []);

  useEffect(() => {
    const id = setTimeout(
      () => void chrome.storage.local.set({ [DRAFT_KEY]: { title, skills, notes, jd, useJd } }),
      400,
    );
    return () => clearTimeout(id);
  }, [title, skills, notes, jd, useJd]);

  async function generate() {
    setError(null);
    setResultId(null);
    setPhase({ label: "Starting", percent: 2 });
    try {
      const path = useJd ? "/api/v1/resumes/generate/job" : "/api/v1/resumes/generate/story";
      const accepted = await api<{ id: string }>(path, {
        method: "POST",
        body: JSON.stringify({
          target_title: title,
          extra_instructions: notes || undefined,
          ...(useJd
            ? { job_description: jd }
            : { skill_count: skills ? Number(skills) : undefined }),
        }),
      });
      const done = await waitForGeneration(accepted.id, (label, percent) => setPhase({ label, percent }));
      setResultId((done.result_id as string) ?? null);
      setPhase({ label: "Done", percent: 100 });
      await chrome.storage.local.remove(DRAFT_KEY);
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
    }
  }

  return (
    <div className="card">
      <Field label="Target title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Senior Software Engineer – AI Fullstack"
        />
      </Field>

      <label className="row small" style={{ marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={useJd}
          onChange={(e) => setUseJd(e.target.checked)}
          style={{ width: "auto" }}
        />
        <span>Base it on a job description</span>
      </label>

      {useJd ? (
        <Field label="Job description">
          <textarea rows={7} value={jd} onChange={(e) => setJd(e.target.value)} />
        </Field>
      ) : (
        <Field label="How many technologies?">
          <input
            type="number"
            min={4}
            max={40}
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
          />
        </Field>
      )}

      <Field label="Anything else?">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <button
        className="btn primary block"
        disabled={!title || Boolean(phase && phase.percent < 100)}
        onClick={generate}
      >
        Generate
      </button>

      {phase && <div style={{ marginTop: 10 }}><Progress label={phase.label} percent={phase.percent} /></div>}
      {error && <div style={{ marginTop: 8 }}><ErrorNote>{error}</ErrorNote></div>}

      {resultId && (
        <button
          className="btn block"
          style={{ marginTop: 8 }}
          onClick={() => downloadDocx({ resume_id: resultId, kind: "base" }, `${title}.docx`)}
        >
          Download .docx
        </button>
      )}
    </div>
  );
}
