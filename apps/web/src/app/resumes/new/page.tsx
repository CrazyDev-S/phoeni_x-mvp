"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FindingsList } from "@/components/findings";
import { Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { useGeneration } from "@/hooks/use-generation";
import { request } from "@/lib/api";

type Tab = "upload" | "story" | "job";

export default function NewResumePage() {
  const [tab, setTab] = useState<Tab>("upload");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New resume</h1>
      <div className="flex gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
        {(
          [
            ["upload", "Paste existing"],
            ["story", "Generate from a story"],
            ["job", "Generate from a job"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${
              tab === key
                ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]"
                : "text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "upload" && <UploadForm />}
      {tab === "story" && <GenerateForm kind="story" />}
      {tab === "job" && <GenerateForm kind="job" />}
    </div>
  );
}

function UploadForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parseHint, setParseHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setParseHint(null);
    try {
      const created = await request<{ id: string }>("/api/v1/resumes", {
        method: "POST",
        body: JSON.stringify({
          display_name: displayName,
          target_title: targetTitle,
          content_md: content,
        }),
      });
      router.push(`/resumes/${created.id}`);
    } catch (err) {
      const e = err as { code?: string; message?: string; detail?: Record<string, unknown> };
      setError(e.message ?? "Could not save");
      if (e.code === "CRM_PARSE_ERROR" && e.detail) {
        setParseHint(
          `Line ${e.detail.line} in ${e.detail.section}: ${String(e.detail.line_text ?? "")}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" hint="Include the stack, e.g. “Senior AI Fullstack — Python/FastAPI”.">
          <Input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Target title">
          <Input required value={targetTitle} onChange={(e) => setTargetTitle(e.target.value)} />
        </Field>
        <Field
          label="Resume (Canonical Resume Markdown)"
          hint="Parsed on save — a document that cannot be read back cannot be exported, so it is checked here rather than at download time."
        >
          <Textarea
            required
            rows={18}
            className="mono text-xs"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"---\nname: Your Name\ntitle: Senior Engineer\nlocation: City, Country\n---\n\n## PROFESSIONAL SUMMARY\n\n…"}
          />
        </Field>
        {error && (
          <div className="space-y-1">
            <ErrorNote>{error}</ErrorNote>
            {parseHint && <p className="mono text-xs text-[var(--color-ink-soft)]">{parseHint}</p>}
          </div>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          Save resume
        </Button>
      </form>
    </Card>
  );
}

function GenerateForm({ kind }: { kind: "story" | "job" }) {
  const router = useRouter();
  const { state, start } = useGeneration();
  const [targetTitle, setTargetTitle] = useState("");
  const [skillCount, setSkillCount] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [extra, setExtra] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await start(`/api/v1/resumes/generate/${kind}`, {
      target_title: targetTitle,
      extra_instructions: extra || undefined,
      ...(kind === "story"
        ? { skill_count: skillCount ? Number(skillCount) : undefined }
        : { job_description: jobDescription }),
    });
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Target title">
          <Input
            required
            placeholder="Senior Software Engineer – AI Fullstack"
            value={targetTitle}
            onChange={(e) => setTargetTitle(e.target.value)}
          />
        </Field>

        {kind === "story" ? (
          <>
            <Field label="How many technologies overall?" hint="Still spread across exactly four categories.">
              <Input
                type="number"
                min={4}
                max={40}
                value={skillCount}
                onChange={(e) => setSkillCount(e.target.value)}
              />
            </Field>
            <Field label="Anything else that should shape it?">
              <Textarea rows={5} value={extra} onChange={(e) => setExtra(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Job description">
            <Textarea
              required
              rows={12}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full posting…"
            />
          </Field>
        )}

        <Button type="submit" variant="primary" loading={state.running}>
          Generate
        </Button>

        {(state.running || state.error || state.resultId) && (
          <ProgressPanel state={state} onOpen={(id) => router.push(`/resumes/${id}`)} />
        )}
      </form>
    </Card>
  );
}

export function ProgressPanel({
  state,
  onOpen,
}: {
  state: ReturnType<typeof useGeneration>["state"];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
      <div className="flex items-center justify-between text-sm">
        <span>{state.label || "Working…"}</span>
        <span className="text-[var(--color-ink-soft)]">{state.pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
        <div
          className="h-full bg-[var(--color-brand)] transition-[width] duration-500"
          style={{ width: `${state.pct}%` }}
        />
      </div>
      {state.thinking && (
        <details className="text-xs text-[var(--color-ink-soft)]">
          <summary className="cursor-pointer">Reasoning</summary>
          <p className="mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap">
            {state.thinking}
          </p>
        </details>
      )}
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.findings.length > 0 && (
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]">
          <FindingsList findings={state.findings} />
        </div>
      )}
      {state.resultId && onOpen && (
        <Button variant="primary" onClick={() => onOpen(state.resultId!)}>
          Open the result
        </Button>
      )}
    </div>
  );
}
