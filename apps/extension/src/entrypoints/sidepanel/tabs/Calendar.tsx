import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Err, fmtTime } from "../components";

interface Meeting {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  conferencing_url: string | null;
  preparation_notes: string | null;
}

const STATUSES = ["scheduled", "held", "cancelled", "rescheduled", "no_show"];

/** Day agenda, not a month grid — the panel is ~360px wide. */
export function CalendarTab() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Meeting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (target: string) => {
    setBusy(true);
    try {
      setItems(await api<Meeting[]>(`/api/v1/meetings?from=${target}&to=${target}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => void load(day), [day, load]);

  async function setStatus(id: string, status: string) {
    // Optimistic: the panel is often used while a call is starting.
    setItems((list) => list.map((m) => (m.id === id ? { ...m, status } : m)));
    try {
      await api(`/api/v1/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      setError((e as Error).message);
      void load(day);
    }
  }

  function shift(days: number) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setDate(d.getDate() + days);
    setDay(d.toISOString().slice(0, 10));
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => shift(-1)}>‹</button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button className="btn" onClick={() => shift(1)}>›</button>
      </div>
      <p className="small muted" style={{ margin: "0 0 8px" }}>
        All times US Eastern.
      </p>

      {error && <Err>{error}</Err>}
      {busy && <p className="small muted">Loading…</p>}
      {!busy && !items.length && <p className="small muted">Nothing scheduled.</p>}

      <ul className="list">
        {items.map((m) => (
          <li key={m.id} style={{ padding: "8px 0" }}>
            <div className="row">
              <strong>{fmtTime(m.starts_at)}</strong>
              <span className="truncate" style={{ flex: 1 }}>{m.title}</span>
            </div>
            <div className="row small" style={{ marginTop: 4 }}>
              <select
                value={m.status}
                onChange={(e) => setStatus(m.id, e.target.value)}
                style={{ flex: 1 }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
              {m.conferencing_url && (
                <a className="btn" href={m.conferencing_url} target="_blank" rel="noreferrer">
                  Join
                </a>
              )}
            </div>
            {m.preparation_notes && (
              <p className="small muted" style={{ margin: "4px 0 0" }}>{m.preparation_notes}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
