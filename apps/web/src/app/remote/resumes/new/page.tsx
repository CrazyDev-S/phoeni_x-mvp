"use client";

import { FileText, Sparkles, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { PageHero } from "@/components/page-hero";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGeneration } from "@/hooks/use-generation";
import { request } from "@/lib/api";
import { cn } from "@/lib/utils";

const MODES = [
  { value: "upload", Icon: Upload, title: "Upload existing" },
  { value: "story", Icon: Sparkles, title: "From a story" },
  { value: "job", Icon: FileText, title: "From a job" },
];

export default function NewResumePage() {
  return (
    <div className="space-y-3">
      <PageHero title="Add a resume" back="/remote/resumes" />

      <Tabs defaultValue="upload" className="max-w-3xl min-w-0 gap-3">
        <TabsList>
          {MODES.map(({ value, Icon, title }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5">
              <Icon />
              {title}
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
    </div>
  );
}

/** What the backend can read; mirrors app/remote/services/documents.py. */
const ACCEPTED = ".pdf,.docx,.odt,.rtf,.html,.htm,.txt,.md,.markdown";
const ACCEPTED_LABEL = "PDF, Word, ODT, RTF, HTML, Markdown or text";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface ImportAccepted {
  id: string;
  direct: boolean;
  result_id: string | null;
  warnings: string[];
}

function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, attach, stop } = useGeneration();
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // The restyled resume opens as soon as the job saves it.
  useEffect(() => {
    if (!state.running && state.resultId) router.push(`/remote/resumes/${state.resultId}`);
  }, [state.running, state.resultId, router]);

  function choose(next: File | undefined) {
    if (!next) return;
    setError(null);
    if (!/\.(pdf|docx|odt|rtf|html?|txt|md|markdown)$/i.test(next.name)) {
      setError(
        /\.doc$/i.test(next.name)
          ? "Old .doc files are not supported. Save it as .docx or PDF and upload that."
          : `That file type is not supported. Upload ${ACCEPTED_LABEL}.`,
      );
      return;
    }
    if (next.size > MAX_FILE_BYTES) {
      setError("That file is larger than 8 MB.");
      return;
    }
    setFile(next);
  }

  const working = sending || state.running;
  const ready = Boolean(file) || pasted.trim().length >= 80;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || working) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else form.append("text", pasted);
      if (displayName.trim()) form.append("display_name", displayName.trim());
      if (targetTitle.trim()) form.append("target_title", targetTitle.trim());
      const accepted = await request<ImportAccepted>("/api/v1/remote/resumes/import", {
        method: "POST",
        body: form,
      });
      // Already in the house format: saved on the spot, nothing to follow.
      if (accepted.direct && accepted.result_id) {
        router.push(`/remote/resumes/${accepted.result_id}`);
        return;
      }
      attach(accepted.id);
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not import that file");
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel className="p-3">
      <form onSubmit={submit}>
        <FieldGroup className="gap-3">
          <FormField label="Your resume">
            {(control) => (
              <div className="space-y-2">
                <input
                  ref={inputRef}
                  id={control.id}
                  type="file"
                  accept={ACCEPTED}
                  className="sr-only"
                  disabled={working}
                  onChange={(e) => {
                    choose(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    if (!working) choose(e.dataTransfer.files[0]);
                  }}
                  className={cn(
                    "flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors",
                    dragging ? "border-primary bg-accent/60" : "border-border",
                  )}
                >
                  {file ? (
                    <div className="flex items-center gap-3">
                      <FileText className="text-brand size-5 shrink-0" />
                      <div className="min-w-0 text-left">
                        <p className="truncate font-semibold">{file.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {(file.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remove the file"
                        disabled={working}
                        onClick={() => setFile(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Upload className="text-muted-foreground size-5" />
                      <p className="text-[13px] font-medium">Drop your resume here</p>
                      <p className="text-muted-foreground text-xs">{ACCEPTED_LABEL} · up to 8 MB</p>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => inputRef.current?.click()}
                  >
                    {file ? "Choose a different file" : "Choose a file"}
                  </Button>
                </div>
              </div>
            )}
          </FormField>

          {!file && (
            <FormField label="Or paste the text">
              {(control) => (
                <Textarea
                  {...control}
                  rows={7}
                  disabled={working}
                  className="field-sizing-fixed min-h-40 leading-5"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste your resume text here…"
                />
              )}
            </FormField>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Name (optional)">
              {(control) => (
                <Input
                  {...control}
                  disabled={working}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Target title (optional)">
              {(control) => (
                <Input
                  {...control}
                  disabled={working}
                  value={targetTitle}
                  onChange={(e) => setTargetTitle(e.target.value)}
                />
              )}
            </FormField>
          </div>

          {error && <ErrorAlert>{error}</ErrorAlert>}

          {(state.running || state.error) && (
            <GenerationProgress state={state} onStop={stop} />
          )}

          <Button
            type="submit"
            variant="brand"
            className="w-full"
            disabled={!ready || working}
          >
            {working ? <Spinner /> : <Sparkles />}
            {working ? "Importing…" : "Import and restyle"}
          </Button>
        </FieldGroup>
      </form>
    </Panel>
  );
}

function GenerateForm({ kind }: { kind: "story" | "job" }) {
  const router = useRouter();
  const { state, start, stop } = useGeneration();
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
    <Panel className="p-3">
      <form onSubmit={submit}>
        <FieldGroup className="gap-3">
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
              <FormField label="How many technologies overall?">
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
                    rows={4}
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
                  rows={10}
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
            className="w-full"
            disabled={state.running}
          >
            {state.running ? <Spinner /> : <Sparkles />}
            {state.running ? state.label || "Working…" : "Generate"}
          </Button>

          {(state.running || state.error || state.resultId) && (
            <GenerationProgress
              state={state}
              onOpen={(id) => router.push(`/remote/resumes/${id}`)}
              onStop={stop}
            />
          )}
        </FieldGroup>
      </form>
    </Panel>
  );
}
