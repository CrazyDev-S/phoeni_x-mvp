import { useEffect, useState } from "react";

import { api, getSettings, saveSettings } from "@/lib/api";
import { DEFAULT_API_BASE } from "@/lib/constants";
import { Err, Field } from "../components";

export function SettingsTab({ onSaved }: { onSaved: () => void }) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then((s) => {
      setApiBase(s.apiBase);
      setToken(s.token);
    });
  }, []);

  async function save() {
    setError(null);
    setStatus(null);
    await saveSettings({ apiBase, token });
    try {
      const me = await api<{ email: string }>("/api/v1/auth/me");
      setStatus(`Connected as ${me.email}`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <Field label="Backend URL">
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
      </Field>
      <Field label="Access token">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="rat_…"
        />
      </Field>
      <p className="small muted" style={{ margin: "0 0 8px" }}>
        Create a token in the web portal under Settings → API tokens. It is
        stored locally in this browser and never synced.
      </p>
      <button className="btn primary block" onClick={save}>Save &amp; test</button>
      {status && <p className="small ok" style={{ marginTop: 8 }}>{status}</p>}
      {error && <div style={{ marginTop: 8 }}><Err>{error}</Err></div>}
    </div>
  );
}
