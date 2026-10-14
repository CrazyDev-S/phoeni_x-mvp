"use client";

import {
  Briefcase,
  ClipboardPaste,
  FileText,
  Lightbulb,
  ListChecks,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { PageHero } from "@/components/page-hero";
import { CheckList, SidePanel } from "@/components/side-panel";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

const ON_SAVE = [
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

const MODES = [
  {
    value: "upload",
    Icon: ClipboardPaste,
    title: "Paste existing",
    detail: "You already have a resume in Canonical Resume Markdown.",
  },
  {
    value: "story",
    Icon: Sparkles,
    title: "From a story",
    detail: "Describe the career you want represented and let it build one.",
  },
  {
    value: "job",
    Icon: Briefcase,
    title: "From a job",
    detail: "Start from a posting and work backwards to a base resume.",
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
    <div className="space-y-7">
      <PageHero title="Add a resume" back="/remote/resumes" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
        <Tabs defaultValue="upload" className="min-w-0 gap-5">
          <TabsList className="grid h-auto w-full items-stretch group-data-horizontal/tabs:h-auto grid-cols-1 gap-4 rounded-none bg-transparent p-0 shadow-none sm:grid-cols-3">
            {MODES.map(({ value, Icon, title, detail }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="group/mode bg-card shadow-card data-[state=active]:bg-panel data-[state=active]:text-panel-foreground h-auto flex-none items-center justify-start gap-4 rounded-[28px] px-[1.125rem] py-[1.125rem] text-left whitespace-normal data-[state=active]:shadow-none"
              >
                <Tile
                  icon={Icon}
                  size="lg"
                  className="size-12 group-data-[state=active]/mode:bg-brand group-data-[state=active]/mode:text-brand-foreground"
                />
                <span className="min-w-0">
                  <span className="block text-[1.0625rem] font-bold tracking-tight">
                    {title}
                  </span>
                  <span className="text-muted-foreground group-data-[state=active]/mode:text-panel-muted mt-0.5 block text-[0.8125rem] leading-snug font-medium">
                    {detail}
                  </span>
                </span>
              </TabsTrigger>
            ))}
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

        <aside className="space-y-5 lg:sticky lg:top-24">
          <SidePanel icon={Lightbulb} title="Tips for better results">
            <CheckList items={NEW_RESUME_TIPS} />
          </SidePanel>
          <SidePanel
            icon={ShieldCheck}
            title="What happens on save"
            tone="dark"
          >
            <ul className="divide-panel-raised divide-y">
              {ON_SAVE.map(({ Icon, title, detail }) => (
                <li
                  key={title}
                  className="flex gap-3.5 py-5 first:pt-1 last:pb-0"
                >
                  <Tile
                    icon={Icon}
                    tone="ink"
                    size="sm"
                    className="bg-panel-raised"
                  />
                  <div>
                    <p className="font-semibold">{title}</p>
                    <p className="text-panel-muted mt-1 text-sm leading-relaxed">
                      {detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
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
      const created = await request<{ id: string }>("/api/v1/remote/resumes", {
        method: "POST",
        body: JSON.stringify({
          display_name: displayName,
          target_title: targetTitle,
          content_markdown: content,
        }),
      });
      router.push(`/remote/resumes/${created.id}`);
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
    <Card className="gap-0 p-5 md:px-8 md:py-8">
      <form onSubmit={submit}>
        <FieldGroup className="gap-6">
          <div className="grid gap-5 md:grid-cols-2 md:gap-5">
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

            <FormField
              label="Target title"
              hint="Keep it close to the roles you will apply for."
            >
              {(control) => (
                <Input
                  {...control}
                  required
                  value={targetTitle}
                  onChange={(e) => setTargetTitle(e.target.value)}
                />
              )}
            </FormField>
          </div>

          <FormField label="Resume (Canonical Resume Markdown)">
            {(control) => (
              <div className="bg-panel text-panel-foreground overflow-hidden rounded-[26px]">
                <div className="border-panel-raised flex items-center gap-2.5 border-b py-3.5 pr-4 pl-5">
                  <FileText className="text-brand size-4" />
                  <span className="text-panel-muted text-[0.8125rem] font-semibold">
                    resume.md
                  </span>
                  <Badge className="bg-panel-raised text-panel-muted ml-auto">
                    <ShieldCheck />
                    Parsed on save
                  </Badge>
                </div>
                <Textarea
                  {...control}
                  required
                  rows={18}
                  spellCheck={false}
                  className="field-sizing-fixed placeholder:text-panel-muted caret-brand min-h-96 rounded-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-6 font-normal focus-visible:bg-transparent"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={CRM_PLACEHOLDER}
                />
              </div>
            )}
          </FormField>

          {error && (
            <ErrorAlert>
              {error}
              {parseHint && (
                <span className="mt-1 block font-mono text-xs">
                  {parseHint}
                </span>
              )}
            </ErrorAlert>
          )}

          <Button
            type="submit"
            variant="brand"
            size="lg"
            className="h-14 w-full text-base"
            disabled={busy}
          >
            {busy ? <Spinner /> : <Save />}
            Save resume
          </Button>
        </FieldGroup>
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
    await start(`/api/v1/remote/resumes/generate/${kind}`, {
      target_title: targetTitle,
      extra_instructions: extra || undefined,
      ...(kind === "story"
        ? { skill_count: skillCount ? Number(skillCount) : undefined }
        : { job_description: jobDescription }),
    });
  }

  return (
    <Card className="gap-0 p-5 md:px-8 md:py-8">
      <form onSubmit={submit}>
        <FieldGroup className="gap-6">
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
            variant="brand"
            size="lg"
            className="h-14 w-full text-base"
            disabled={state.running}
          >
            {state.running ? <Spinner /> : <Sparkles />}
            {state.running ? state.label || "Working…" : "Generate"}
          </Button>

          {(state.running || state.error || state.resultId) && (
            <GenerationProgress
              state={state}
              onOpen={(id) => router.push(`/remote/resumes/${id}`)}
            />
          )}
        </FieldGroup>
      </form>
    </Card>
  );
}
