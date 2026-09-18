"use client";

import {
  Briefcase,
  ClipboardPaste,
  FilePlus2,
  Lightbulb,
  ListChecks,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { GenerationProgress } from "@/components/generation-progress";
import { PageHero } from "@/components/page-hero";
import { CheckList, PointList, SidePanel, type PointItem } from "@/components/side-panel";
import { StepsBand } from "@/components/steps-band";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGeneration } from "@/hooks/use-generation";
import { request } from "@/lib/api";

const NEW_RESUME_TIPS = [
  "Name it for the stack, e.g. “Senior AI Fullstack — Python/FastAPI”.",
  "Keep the target title close to the roles you will apply for.",
  "One base resume per stack beats one per company.",
  "Generated resumes still need a read before you send them.",
];

const ON_SAVE: PointItem[] = [
  {
    Icon: ShieldCheck,
    title: "It is parsed, not just stored",
    detail:
      "A document that cannot be read back cannot be exported, so it is checked here rather than at download time.",
  },
  {
    Icon: ListChecks,
    title: "Hard rules are re-checked",
    detail:
      "No placeholders, exactly four skill categories, and tenure arithmetic that agrees with the claimed years.",
  },
];

const CRM_PLACEHOLDER = `---
name: Your Name
title: Senior Engineer
location: City, Country
---

## PROFESSIONAL SUMMARY

…`;

export default function NewResumePage() {
  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Step one"
        eyebrowIcon={FilePlus2}
        title="Add a resume"
        description="Start from something you already have, or let the generator build one from a story or a posting."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Tabs defaultValue="upload" className="gap-4">
            <TabsList className="h-11 w-full">
              <TabsTrigger value="upload" className="gap-1.5">
                <ClipboardPaste className="hidden size-4 sm:block" />
                Paste existing
              </TabsTrigger>
              <TabsTrigger value="story" className="gap-1.5">
                <Sparkles className="hidden size-4 sm:block" />
                From a story
              </TabsTrigger>
              <TabsTrigger value="job" className="gap-1.5">
                <Briefcase className="hidden size-4 sm:block" />
                From a job
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload">
              <UploadForm />
            </TabsContent>
            <TabsContent value="story">
              <GenerateForm kind="story" />
            </TabsContent>
            <TabsContent value="job">
              <GenerateForm kind="job" />
            </TabsContent>
          </Tabs>

          <StepsBand
            title="Which option?"
            description="Three ways in, one library out."
            steps={[
              {
                title: "Paste existing",
                detail: "You already have a resume in Canonical Resume Markdown.",
              },
              {
                title: "From a story",
                detail: "Describe the career you want represented and let it build one.",
              },
              {
                title: "From a job",
                detail: "Start from a posting and work backwards to a base resume.",
              },
            ]}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <SidePanel icon={Lightbulb} title="Tips for better results">
            <CheckList items={NEW_RESUME_TIPS} />
          </SidePanel>
          <SidePanel icon={ShieldCheck} title="What happens on save">
            <PointList items={ON_SAVE} />
          </SidePanel>
        </aside>
      </div>
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
          content_markdown: content,
        }),
      });
      router.push(`/resumes/${created.id}`);
    } catch (err) {
      const e = err as {
        code?: string;
        message?: string;
        detail?: Record<string, unknown>;
      };
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
    <Card className="py-0">
      <CardContent className="p-5 md:p-6">
        <form onSubmit={submit}>
          <FieldGroup className="gap-5">
            <FormField
              label="Name"
              hint="Include the stack, e.g. “Senior AI Fullstack — Python/FastAPI”."
            >
              {(control) => (
                <Input
                  {...control}
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              )}
            </FormField>

            <FormField label="Target title">
              {(control) => (
                <Input
                  {...control}
                  required
                  value={targetTitle}
                  onChange={(e) => setTargetTitle(e.target.value)}
                />
              )}
            </FormField>

            <FormField
              label="Resume (Canonical Resume Markdown)"
              hint="Parsed on save — a document that cannot be read back cannot be exported, so it is checked here rather than at download time."
            >
              {(control) => (
                <Textarea
                  {...control}
                  required
                  rows={18}
                  className="field-sizing-fixed min-h-80 font-mono text-xs"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={CRM_PLACEHOLDER}
                />
              )}
            </FormField>

            {error && (
              <ErrorAlert>
                {error}
                {parseHint && (
                  <span className="mt-1 block font-mono text-xs">{parseHint}</span>
                )}
              </ErrorAlert>
            )}

            <Button type="submit" size="lg" className="h-12 w-full" disabled={busy}>
              {busy && <Spinner />}
              Save resume
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
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
    <Card className="py-0">
      <CardContent className="p-5 md:p-6">
        <form onSubmit={submit}>
          <FieldGroup className="gap-5">
            <FormField label="Target title">
              {(control) => (
                <Input
                  {...control}
                  required
                  placeholder="Senior Software Engineer – AI Fullstack"
                  value={targetTitle}
                  onChange={(e) => setTargetTitle(e.target.value)}
                />
              )}
            </FormField>

            {kind === "story" ? (
              <>
                <FormField
                  label="How many technologies overall?"
                  hint="Still spread across exactly four categories."
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      min={4}
                      max={40}
                      value={skillCount}
                      onChange={(e) => setSkillCount(e.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Anything else that should shape it?">
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={5}
                      value={extra}
                      onChange={(e) => setExtra(e.target.value)}
                    />
                  )}
                </FormField>
              </>
            ) : (
              <FormField label="Job description">
                {(control) => (
                  <Textarea
                    {...control}
                    required
                    rows={12}
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Paste the full posting…"
                  />
                )}
              </FormField>
            )}

            <Button
              type="submit"
              size="lg"
              className="h-12 w-full"
              disabled={state.running}
            >
              {state.running ? <Spinner /> : <Sparkles />}
              {state.running ? state.label || "Working…" : "Generate"}
            </Button>

            {(state.running || state.error || state.resultId) && (
              <GenerationProgress
                state={state}
                onOpen={(id) => router.push(`/resumes/${id}`)}
              />
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
