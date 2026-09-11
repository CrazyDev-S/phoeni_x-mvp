"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";
import { request } from "@/lib/api";

interface Credential {
  provider: string;
  configured: boolean;
  masked_key: string;
  status: string;
  last_error: string | null;
}

interface Settings {
  default_provider: string;
  heavy_model: string;
  mid_model: string;
  fast_model: string;
  base_country: string;
  research_dossiers: boolean;
  strict_dossier: boolean;
  allow_real_company_names: boolean;
  display_timezone: string;
  credentials: Credential[];
}

interface ModelRow {
  provider: string;
  model_id: string;
  display_name: string;
  tier: string;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState("");
  const [keyProvider, setKeyProvider] = useState("anthropic");
  const [testResult, setTestResult] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => request<Settings>("/api/v1/settings"),
  });
  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: () => request<ModelRow[]>("/api/v1/settings/models"),
  });

  const patch = useMutation({
    mutationFn: (body: Partial<Settings>) =>
      request<Settings>("/api/v1/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });

  const saveKey = useMutation({
    mutationFn: () =>
      request("/api/v1/settings/api-key", {
        method: "PUT",
        body: JSON.stringify({ provider: keyProvider, api_key: keyInput }),
      }),
    onSuccess: () => {
      setKeyInput("");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const test = useMutation({
    mutationFn: () =>
      request<{ ok: boolean; detail: string; model: string }>(
        "/api/v1/settings/test-connection",
        { method: "POST" },
      ),
    onSuccess: (r) => {
      setTestResult(r.ok ? `Connected to ${r.model}` : r.detail);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => setTestResult((e as Error).message),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[var(--color-ink-soft)]">
        <Spinner /> Loading…
      </div>
    );
  }

  const byTier = (tier: string) =>
    (models ?? []).filter((m) => m.provider === data.default_provider && m.tier === tier);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card title="API keys" className="p-0">
        <div className="space-y-4 p-5">
          <p className="text-sm text-[var(--color-ink-soft)]">
            Keys are encrypted at rest and are never returned by the API — only a
            mask and a status.
          </p>
          <ul className="space-y-2">
            {data.credentials.map((c) => (
              <li
                key={c.provider}
                className="flex items-center gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
              >
                <span className="w-24 font-medium capitalize">{c.provider}</span>
                <span className="mono flex-1 text-[var(--color-ink-soft)]">{c.masked_key}</span>
                <Badge tone={c.status === "valid" ? "ok" : c.status === "invalid" ? "bad" : "neutral"}>
                  {c.status}
                </Badge>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Provider">
              <Select value={keyProvider} onChange={(e) => setKeyProvider(e.target.value)}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </Select>
            </Field>
            <div className="min-w-[16rem] flex-1">
              <Field label="API key">
                <Input
                  type="password"
                  placeholder="sk-ant-…"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                />
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={keyInput.length < 12}
              loading={saveKey.isPending}
              onClick={() => saveKey.mutate()}
            >
              Save key
            </Button>
            <Button loading={test.isPending} onClick={() => test.mutate()}>
              Test connection
            </Button>
          </div>
          {testResult && (
            <p className="text-sm text-[var(--color-ink-soft)]">{testResult}</p>
          )}
          {saveKey.isError && <ErrorNote>{(saveKey.error as Error).message}</ErrorNote>}
        </div>
      </Card>

      <Card title="Models" className="p-0">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Provider">
            <Select
              value={data.default_provider}
              onChange={(e) => patch.mutate({ default_provider: e.target.value })}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </Select>
          </Field>
          {(
            [
              ["heavy_model", "Heavy — scenario and drafting"],
              ["mid_model", "Mid — short edits"],
              ["fast_model", "Fast — form answers"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Select
                value={data[key]}
                onChange={(e) => patch.mutate({ [key]: e.target.value })}
              >
                <option value={data[key]}>{data[key]}</option>
                {byTier(key.split("_")[0])
                  .filter((m) => m.model_id !== data[key])
                  .map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.display_name}
                    </option>
                  ))}
              </Select>
            </Field>
          ))}
        </div>
      </Card>

      <ExtensionTokens />

      <Card title="Generation" className="p-0">
        <div className="space-y-4 p-5">
          <Field
            label="Base country"
            hint="Overrides the generator prompt's default. Sets the universities, academic calendar and work-mode timeline used for constructed scenarios."
          >
            <Input
              defaultValue={data.base_country}
              onBlur={(e) =>
                e.target.value !== data.base_country &&
                patch.mutate({ base_country: e.target.value })
              }
            />
          </Field>

          {(
            [
              ["research_dossiers", "Research company dossiers", "Uses web search so a named employer has verifiable facts behind it."],
              ["strict_dossier", "Block unverified employers", "In Mode B, refuse to ship a resume naming a company with no sourced dossier."],
              ["allow_real_company_names", "Allow real company names in Mode B", "Off by default. Naming a real employer you have not worked for is fabricated employment history on a live application."],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={data[key]}
                onChange={(e) => patch.mutate({ [key]: e.target.checked })}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-[var(--color-ink-soft)]">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}


interface TokenRow {
  id: string;
  name: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Long-lived tokens for the browser side panel, which cannot share a session. */
function ExtensionTokens() {
  const qc = useQueryClient();
  const [name, setName] = useState("Chrome side panel");
  const [fresh, setFresh] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => request<TokenRow[]>("/api/v1/auth/tokens"),
  });

  const create = useMutation({
    mutationFn: () =>
      request<TokenRow & { token: string }>("/api/v1/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (row) => {
      setFresh(row.token);
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      request(`/api/v1/auth/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  return (
    <Card title="Extension tokens" className="p-0">
      <div className="space-y-4 p-5">
        <p className="text-sm text-[var(--color-ink-soft)]">
          The browser extension authenticates with its own long-lived token.
          Only a hash is stored, so the value is shown exactly once.
        </p>

        {fresh && (
          <div className="space-y-2 rounded-md border border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-3">
            <p className="text-xs font-medium">
              Copy this now — it will not be shown again.
            </p>
            <div className="flex gap-2">
              <code className="mono flex-1 truncate rounded bg-[var(--color-surface)] px-2 py-1 text-xs">
                {fresh}
              </code>
              <Button size="sm" onClick={() => navigator.clipboard.writeText(fresh)}>
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {data?.filter((t) => !t.revoked_at).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            >
              <span className="flex-1">{t.name}</span>
              <span className="text-xs text-[var(--color-ink-soft)]">
                {t.last_used_at ? `used ${new Date(t.last_used_at).toLocaleDateString()}` : "never used"}
              </span>
              <Button size="sm" variant="danger" onClick={() => revoke.mutate(t.id)}>
                Revoke
              </Button>
            </li>
          ))}
          {!data?.filter((t) => !t.revoked_at).length && (
            <li className="text-sm text-[var(--color-ink-soft)]">No active tokens.</li>
          )}
        </ul>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Token name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Create token
          </Button>
        </div>
      </div>
    </Card>
  );
}
