"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ClipboardPaste,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { GenerationProgress } from "@/components/generation-progress";
import { PageHero } from "@/components/page-hero";
import { HowItWorks, TipsPanel, WhyPanel } from "@/components/tailor/side-panels";
import { ResultPanel } from "@/components/tailor/result-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGeneration } from "@/hooks/use-generation";
import { request } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The API's own bounds, so the counter cannot promise something it will reject. */
const JD_MIN = 40;
const JD_MAX = 60_000;
const INSTRUCTION_MAX = 8_000;

type Mode = "job" | "instruction";
type Strategy = "existing" | "full";

interface ResumeOption {
  id: string;
  display_name: string;
  target_title: string;
}

interface ApplicationPrefill {
  id: string;
  company_name: string;
  role_title: string;
  job_url: string | null;
  job_description_text: string | null;
}

export default function TailorPage() {
  // useSearchParams needs a Suspense boundary, or the route renders client-only.
  return (
    <Suspense fallback={null}>
      <TailorForm />
    </Suspense>
  );
}

function TailorForm() {
  const [mode, setMode] = useState<Mode>("job");
  const { state, start, reset } = useGeneration();

  const { data: resumes, isLoading: resumesLoading } = useQuery({
    queryKey: ["resumes", ""],
    queryFn: () => request<{ items: ResumeOption[] }>("/api/v1/resumes"),
  });

  const [baseId, setBaseId] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [strategy, setStrategy] = useState<Strategy>("existing");

  // ?application=<id>: tailoring for a tracked application. Its job details
  // are filled in once, and the result is linked back to it.
  const searchParams = useSearchParams();
  const applicationId = searchParams.get("application");
  const requestedBase = searchParams.get("base");
  const { data: application } = useQuery({
    queryKey: ["application", applicationId],
    queryFn: () => request<ApplicationPrefill>(`/api/v1/applications/${applicationId}`),
    enabled: Boolean(applicationId),
  });
  const prefilled = useRef(false);
  useEffect(() => {
    if (!application || prefilled.current) return;
    prefilled.current = true;
    setJobDescription((current) => current || (application.job_description_text ?? ""));
    setCompany((current) => current || application.company_name);
    setJobTitle((current) => current || application.role_title);
    setJobUrl((current) => current || (application.job_url ?? ""));
  }, [application]);

  const options = resumes?.items ?? [];

  // ?base=<id>: start from the resume this job was last tailored from.
  useEffect(() => {
    if (requestedBase && !baseId && options.some((option) => option.id === requestedBase)) {
      setBaseId(requestedBase);
    }
  }, [requestedBase, baseId, options]);
  const jdReady = jobDescription.trim().length >= JD_MIN;
  const canSubmit =
    Boolean(baseId) &&
    !state.running &&
    (mode === "job" ? jdReady : instructions.trim().length >= 3);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    if (mode === "job") {
      await start("/api/v1/tailoring/job", {
        base_resume_id: baseId,
        job_description: jobDescription,
        job_url: jobUrl || undefined,
        company_name: company || undefined,
        job_title: jobTitle || undefined,
        source: "web",
        strategy,
        application_id: application?.id,
      });
    } else {
      await start("/api/v1/tailoring/instruction", {
        base_resume_id: baseId,
        instructions,
      });
    }
  }

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="AI-Powered"
        eyebrowIcon={Sparkles}
        title="Tailor your resume"
        description="Paste a job description and choose a base resume, and let AI create a tailored version that matches the job requirements."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {application && (
            <div className="border-primary/25 bg-accent/50 flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4 text-sm">
              <p className="min-w-0 flex-1">
                Tailoring for{" "}
                <span className="font-medium">
                  {application.company_name} · {application.role_title}
                </span>
                . The result is linked to that application.
                {!application.job_description_text?.trim() &&
                  " No job description is saved with it — paste one below."}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href={`/applications/${application.id}`}>Back to the application</Link>
              </Button>
            </div>
          )}

          <Card className="py-0">
            <CardContent className="p-5 md:p-6">
              <form onSubmit={submit}>
                <FieldGroup className="gap-6">
                  <BaseResumePicker
                    value={baseId}
                    onChange={setBaseId}
                    options={options}
                    loading={resumesLoading}
                  />

                  <Tabs
                    value={mode}
                    onValueChange={(v) => setMode(v as Mode)}
                    className="gap-5"
                  >
                    <TabsList className="h-11 w-full">
                      <TabsTrigger value="job" className="gap-2">
                        <ClipboardPaste className="hidden size-4 sm:block" />
                        <span className="sm:hidden">Job description</span>
                        <span className="hidden sm:inline">Paste job description</span>
                      </TabsTrigger>
                      <TabsTrigger value="instruction" className="gap-2">
                        <FileText className="hidden size-4 sm:block" />
                        <span className="sm:hidden">Instruction</span>
                        <span className="hidden sm:inline">Edit by instruction</span>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="job">
                      <FieldGroup className="gap-5">
                        <StrategyPicker value={strategy} onChange={setStrategy} />

                        <JobDescriptionInput
                          value={jobDescription}
                          onChange={setJobDescription}
                        />

                        <div className="grid gap-4 sm:grid-cols-3">
                          <FormField label="Company">
                            {(control) => (
                              <Input
                                {...control}
                                value={company}
                                onChange={(e) => setCompany(e.target.value)}
                                placeholder="Optional"
                              />
                            )}
                          </FormField>
                          <FormField label="Role title">
                            {(control) => (
                              <Input
                                {...control}
                                value={jobTitle}
                                onChange={(e) => setJobTitle(e.target.value)}
                                placeholder="Optional"
                              />
                            )}
                          </FormField>
                          <FormField label="Job URL">
                            {(control) => (
                              <Input
                                {...control}
                                type="url"
                                value={jobUrl}
                                onChange={(e) => setJobUrl(e.target.value)}
                                placeholder="https://…"
                              />
                            )}
                          </FormField>
                        </div>
                      </FieldGroup>
                    </TabsContent>

                    <TabsContent value="instruction">
                      <FormField
                        label="What should change?"
                        hint="Only what you ask for changes; everything else stays identical. This saves back as a base resume."
                      >
                        {(control) => (
                          <>
                            <Textarea
                              {...control}
                              rows={8}
                              maxLength={INSTRUCTION_MAX}
                              value={instructions}
                              onChange={(e) => setInstructions(e.target.value)}
                              className="field-sizing-fixed min-h-44"
                              placeholder="Lead with the RAG work. Cut the KBTG role to two bullets. Retitle for a platform role."
                            />
                            <Counter value={instructions.length} max={INSTRUCTION_MAX} />
                          </>
                        )}
                      </FormField>
                    </TabsContent>
                  </Tabs>

                  <Button
                    type="submit"
                    variant="brand"
                    size="lg"
                    className="h-12 w-full"
                    disabled={!canSubmit}
                  >
                    {state.running ? (
                      <>
                        <Spinner />
                        {state.label || "Working…"}
                      </>
                    ) : (
                      <>
                        <Sparkles />
                        {mode === "instruction"
                          ? "Apply edits"
                          : strategy === "full"
                            ? "Build a new resume for this job"
                            : "Generate tailored resume"}
                        <ArrowRight data-icon="inline-end" />
                      </>
                    )}
                  </Button>

                  {!baseId && !resumesLoading && options.length > 0 && (
                    <p className="text-subtle -mt-2 text-center text-xs">
                      Choose a base resume to continue.
                    </p>
                  )}
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          {state.error && (
            <ErrorAlert title="We couldn’t generate your tailored resume.">
              <span className="block">{state.error}</span>
              <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
                Try again
              </Button>
            </ErrorAlert>
          )}

          {state.running && <GenerationProgress state={state} />}

          {!state.running && !state.error && state.resultId && (
            <ResultPanel state={state} />
          )}

          <HowItWorks />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <TipsPanel />
          <WhyPanel />
        </aside>
      </div>
    </div>
  );
}

const STRATEGIES: { value: Strategy; title: string; body: string; icon: typeof Sparkles }[] = [
  {
    value: "existing",
    title: "Upgrade existing",
    body: "Keeps your employers, titles and dates, and rewrites until it covers every must-have keyword your experience supports.",
    icon: RefreshCw,
  },
  {
    value: "full",
    title: "Full upgrade",
    body: "Builds a new resume from the job description, using your current one as the profile. Slower, and the closest match.",
    icon: WandSparkles,
  },
];

function StrategyPicker({
  value,
  onChange,
}: {
  value: Strategy;
  onChange: (next: Strategy) => void;
}) {
  return (
    <div role="radiogroup" aria-label="How to tailor" className="grid gap-3 sm:grid-cols-2">
      {STRATEGIES.map(({ value: option, title, body, icon: Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              selected ? "border-primary bg-accent/60 ring-primary ring-1" : "hover:bg-muted/50",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon className="text-primary size-4" />
              {title}
            </span>
            <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
              {body}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  const near = value > max * 0.9;
  return (
    <p
      className={cn(
        "text-right text-xs tabular-nums",
        near ? "text-warning font-medium" : "text-subtle",
      )}
    >
      {value.toLocaleString()} / {max.toLocaleString()}
    </p>
  );
}

function BaseResumePicker({
  value,
  onChange,
  options,
  loading,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ResumeOption[];
  loading: boolean;
}) {
  if (!loading && !options.length) {
    return (
      <div className="border-primary/25 bg-accent/50 flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4">
        <FileText className="text-primary size-5 shrink-0" />
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          You need a base resume first — tailoring reframes one you already have.
        </p>
        <Button asChild size="sm">
          <Link href="/resumes/new">
            <Plus />
            Add a resume
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <FormField
      label="Base resume"
      hint="Employers, titles and dates are carried across unchanged — this reframes, it does not invent."
    >
      {(control) => (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={value} onValueChange={onChange} disabled={loading}>
            <SelectTrigger {...control} className="h-11 min-w-0 flex-1">
              <SelectValue placeholder={loading ? "Loading…" : "Choose a resume…"} />
            </SelectTrigger>
            <SelectContent>
              {options.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="lg" className="h-11">
            <Link href="/resumes/new">
              <Plus />
              New
            </Link>
          </Button>
        </div>
      )}
    </FormField>
  );
}

/**
 * The job description, pasted or read out of a file.
 *
 * The file path is deliberately limited to plain text: nothing in this app
 * parses PDF or DOCX, and a drop zone that silently accepted one would be a
 * dead end rather than a feature.
 */
function JobDescriptionInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  async function accept(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      setFileError("Please choose a .txt or .md file, or paste the text instead.");
      return;
    }
    if (file.size > 2_000_000) {
      setFileError("That file is larger than 2MB.");
      return;
    }
    onChange((await file.text()).slice(0, JD_MAX));
    setFileName(file.name);
  }

  return (
    <FormField label="Job description">
      {(control) => (
        <div className="space-y-2">
          <p className="text-muted-foreground -mt-0.5 text-sm">
            Include the role, company, key responsibilities, required skills, and any other
            relevant details.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void accept(e.dataTransfer.files[0]);
            }}
            className={cn(
              "relative rounded-xl transition-colors",
              dragging && "ring-primary bg-accent/60 ring-2",
            )}
          >
            <Textarea
              {...control}
              required
              rows={12}
              maxLength={JD_MAX}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="field-sizing-fixed min-h-64 resize-y"
              placeholder="Paste the job description here…"
            />
            {dragging && (
              <div className="text-primary pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm font-medium">
                <Upload className="size-4" />
                Drop the file to read it in
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input
              ref={inputRef}
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              className="sr-only"
              onChange={(e) => void accept(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => inputRef.current?.click()}
            >
              <Upload />
              Read from a .txt or .md file
            </Button>

            {fileName && (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <FileText className="size-3" />
                {fileName}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear the file"
                  onClick={() => {
                    setFileName(null);
                    onChange("");
                  }}
                >
                  <X />
                </Button>
              </span>
            )}

            <span className="ml-auto">
              <Counter value={value.length} max={JD_MAX} />
            </span>
          </div>

          {fileError && <p className="text-destructive text-xs">{fileError}</p>}
          {value.length > 0 && value.trim().length < JD_MIN && (
            <p className="text-warning text-xs">
              At least {JD_MIN} characters — paste the whole posting for a useful result.
            </p>
          )}
        </div>
      )}
    </FormField>
  );
}
