import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { ErrorNote } from "../components";

interface Job {
  id: string;
  employer_name: string;
  role_title: string;
  start_date: string;
  status: string;
  notes_markdown: string | null;
}

interface Series {
  id: string;
  title: string;
  recurrence_rule: string;
  start_time_local: string;
  is_active: boolean;
}

export function MaintainTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Job[]>("/api/v1/maintained-jobs")
      .then(setJobs)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    try {
      setSeries(await api<Series[]>(`/api/v1/maintained-jobs/${id}/series`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveNotes(id: string, notes: string) {
    try {
      await api(`/api/v1/maintained-jobs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes_markdown: notes }),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error) return <div className="card"><ErrorNote>{error}</ErrorNote></div>;
  if (!jobs.length) {
    return (
      <div className="card small muted">
        No maintained jobs yet. Promote an application once you have signed.
      </div>
    );
  }

  return (
    <>
      {jobs.map((job) => (
        <div className="card" key={job.id}>
          <button
            className="row"
            onClick={() => toggle(job.id)}
            style={{ width: "100%", border: 0, background: "transparent", padding: 0, textAlign: "left" }}
          >
            <strong className="truncate" style={{ flex: 1 }}>{job.employer_name}</strong>
            <span className={`badge ${job.status === "active" ? "ok" : ""}`}>{job.status}</span>
          </button>
          <p className="small muted" style={{ margin: "2px 0 0" }}>
            {job.role_title} · since {job.start_date}
          </p>

          {open === job.id && (
            <div style={{ marginTop: 8 }}>
              <p className="small muted" style={{ margin: "0 0 4px" }}>Recurring meetings</p>
              <ul className="list small">
                {series.length === 0 && <li className="muted">None yet.</li>}
                {series.map((s) => (
                  <li key={s.id} className="row" style={{ padding: "4px 0" }}>
                    <span className="truncate" style={{ flex: 1 }}>{s.title}</span>
                    <span className="muted">{s.start_time_local}</span>
                    {!s.is_active && <span className="badge">paused</span>}
                  </li>
                ))}
              </ul>
              <textarea
                rows={3}
                placeholder="Notes for this job…"
                defaultValue={job.notes_markdown ?? ""}
                onBlur={(e) => saveNotes(job.id, e.target.value)}
                style={{ marginTop: 6 }}
              />
            </div>
          )}
        </div>
      ))}
    </>
  );
}
