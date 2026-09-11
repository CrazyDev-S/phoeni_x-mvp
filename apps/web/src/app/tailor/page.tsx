"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProgressPanel } from "@/app/resumes/new/page";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useGeneration } from "@/hooks/use-generation";
import { downloadDocx, request } from "@/lib/api";

export default function TailorPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"job" | "instruction">("job");
  const { state, start } = useGeneration();

  const { data: resumes } = useQuery({
    queryKey: ["resumes", ""],
    queryFn: () =>
      request<{ items: { id: string; display_name: string }[] }>("/api/v1/resumes"),
  });

  const [baseId, setBaseId] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [instructions, setInstructions] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "job") {
      await start("/api/v1/tailoring/job", {
        base_resume_id: baseId,
        job_description: jobDescription,
        job_url: jobUrl || undefined,
        company_name: company || undefined,
        job_title: jobTitle || undefined,
        source: "web",
      });
    } else {
      await start("/api/v1/tailoring/instruction", {
        base_resume_id: baseId,
        instructions,
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tailor a resume</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Job-based tailoring saves as a tailored version against the posting.
          Instruction-based edits save back as a base resume.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
        {(
          [
            ["job", "To a job description"],
            ["instruction", "By instruction"],
          ] as ["job" | "instruction", string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${
              mode === key
                ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]"
                : "text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Base resume">
            <Select required value={baseId} onChange={(e) => setBaseId(e.target.value)}>
              <option value="">Choose a resume…</option>
              {resumes?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.display_name}
                </option>
              ))}
            </Select>
          </Field>

          {mode === "job" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company">
                  <Input value={company} onChange={(e) => setCompany(e.target.value)} />
                </Field>
                <Field label="Role title">
                  <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </Field>
              </div>
              <Field label="Job URL">
                <Input
                  type="url"
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                  placeholder="https://…"
                />
              </Field>
              <Field
                label="Job description"
                hint="Employers, titles and dates are preserved — this is a reframing, not a new timeline."
              >
                <Textarea
                  required
                  rows={12}
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field
              label="What should change?"
              hint="Only what you ask for changes; everything else stays identical."
            >
              <Textarea
                required
                rows={8}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Lead with the RAG work. Cut the KBTG role to two bullets. Retitle for a platform role."
              />
            </Field>
          )}

          <Button type="submit" variant="primary" loading={state.running}>
            {mode === "job" ? "Tailor to this job" : "Apply edits"}
          </Button>

          {(state.running || state.error || state.resultId) && (
            <>
              <ProgressPanel state={state} />
              {state.resultId && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() =>
                      downloadDocx({
                        resume_id: state.resultId,
                        kind: state.resultKind === "tailored_resume" ? "tailored" : "base",
                        profile: "designed",
                      })
                    }
                  >
                    Download .docx
                  </Button>
                  {state.resultKind === "base_resume" && (
                    <Button onClick={() => router.push(`/resumes/${state.resultId}`)}>
                      Open resume
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </form>
      </Card>
    </div>
  );
}
