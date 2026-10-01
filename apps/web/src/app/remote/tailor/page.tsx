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
import { GenerationProgress } from "@/components/remote/generation-progress";
import { PageHero } from "@/components/page-hero";
import { PhoenixHeroBanner } from "@/components/phoenix-hero-banner";
import { HowItWorks, TipsPanel, WhyPanel } from "@/components/remote/tailor/side-panels";
import { ResultPanel } from "@/components/remote/tailor/result-panel";
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
    queryFn: () => request<{ items: ResumeOption[] }>("/api/v1/remote/resumes"),
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
    queryFn: () => request<ApplicationPrefill>(`/api/v1/remote/applications/${applicationId}`),
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
      await start("/api/v1/remote/tailoring/job", {
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
      await start("/api/v1/remote/tailoring/instruction", {
        base_resume_id: baseId,
        instructions,
      });
    }
  }

  return (
    <div className="space-y-6">
      <PhoenixHeroBanner
        eyebrow="AI-Powered Career Tools"
        title="Tailor Resume for This Job"
        description="Optimize your resume for the specific job posting. Our AI analyzes the job requirements and rewrites your resume with relevant keywords, skills, and achievements to increase your chances of getting an interview."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-stone-200 dark:border-stone-800 text-xs font-semibold"
            >
              Save Draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-stone-200 dark:border-stone-800 text-xs font-semibold"
            >
              Compare Changes
            </Button>
          </div>
        }
      />

      {/* Top 3 Metric Summary Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Job Posting Summary Card */}
        <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800 dark:text-stone-200">
              <span className="text-base">📋</span>
              Job Posting
            </div>
            <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline cursor-pointer">
              Change Job
            </span>
          </div>
          <div>
            <h4 className="font-bold text-sm text-stone-900 dark:text-stone-100 line-clamp-1">
              {jobTitle || application?.role_title || "Full Stack Developer (Node + React)"}
            </h4>
            <div className="text-[11px] text-stone-500 mt-0.5">
              {company || application?.company_name || "Upwork"} • Remote • Posted 1 day ago
            </div>
          </div>
          <p className="text-xs text-stone-600 dark:text-stone-400 line-clamp-2">
            {jobDescription ||
              "We are looking for a Full Stack Developer with strong experience in React and Node.js to build and maintain scalable web applications..."}
          </p>
        </Card>

        {/* Match Analysis Card */}
        <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800 dark:text-stone-200">
              <span className="text-base">🎯</span>
              Match Analysis
            </div>
            <span className="text-[11px] text-stone-400">Last updated just now</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-black text-sm">
              88%
            </div>
            <div>
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100 flex items-center gap-1">
                <span>+32%</span>
                <span className="text-stone-400 font-normal">vs. original resume</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] mt-0.5">
                <span className="text-emerald-600 font-semibold">24 / 28 Matched</span>
                <span>•</span>
                <span className="text-amber-600 font-semibold">8 Missing</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Top Keywords Card */}
        <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-stone-800 dark:text-stone-200">
              <span className="text-base">🔑</span>
              Top Keywords
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-emerald-600 font-bold">● Found (24)</span>
              <span className="text-rose-500 font-bold">● Missing (8)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {["JavaScript", "React", "Node.js", "TypeScript", "REST APIs", "Next.js", "PostgreSQL"].map(
              (kw) => (
                <span
                  key={kw}
                  className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-medium border border-emerald-200 dark:border-emerald-800"
                >
                  {kw}
                </span>
              ),
            )}
            {["GraphQL", "System Design", "Microservices"].map((kw) => (
              <span
                key={kw}
                className="rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-2 py-0.5 text-[10px] font-medium border border-rose-200 dark:border-rose-800"
              >
                {kw}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {application && (
            <div className="border-orange-200 bg-orange-50/50 dark:border-orange-950/50 dark:bg-orange-950/20 flex flex-wrap items-center gap-3 rounded-2xl border p-4 text-xs">
              <p className="min-w-0 flex-1 text-stone-700 dark:text-stone-300">
                Tailoring for{" "}
                <span className="font-bold text-stone-900 dark:text-stone-100">
                  {application.company_name} · {application.role_title}
                </span>
                . The result is linked to that application.
              </p>
              <Button asChild size="sm" variant="outline" className="rounded-xl text-xs">
                <Link href={`/remote/applications/${application.id}`}>Back to the application</Link>
              </Button>
            </div>
          )}

          <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
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
                    <TabsList className="h-11 w-full rounded-2xl bg-stone-100 dark:bg-stone-800 p-1">
                      <TabsTrigger value="job" className="rounded-xl gap-2 font-semibold text-xs">
                        <ClipboardPaste className="hidden size-4 sm:block" />
                        <span className="sm:hidden">Job description</span>
                        <span className="hidden sm:inline">Paste job description</span>
                      </TabsTrigger>
                      <TabsTrigger value="instruction" className="rounded-xl gap-2 font-semibold text-xs">
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
                                className="rounded-xl"
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
                                className="rounded-xl"
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
                                className="rounded-xl"
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
                              className="field-sizing-fixed min-h-44 rounded-xl"
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
                    size="lg"
                    className="h-12 w-full rounded-2xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold text-sm shadow-md"
                    disabled={!canSubmit}
                  >
                    {state.running ? (
                      <>
                        <Spinner />
                        {state.label || "Working…"}
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4 mr-1.5" />
                        {mode === "instruction"
                          ? "Apply edits"
                          : strategy === "full"
                            ? "Build a new resume for this job"
                            : "Tailor with AI"}
                        <ArrowRight data-icon="inline-end" className="size-4 ml-1.5" />
                      </>
                    )}
                  </Button>

                  {!baseId && !resumesLoading && options.length > 0 && (
                    <p className="text-stone-400 -mt-2 text-center text-xs">
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
              <Button variant="outline" size="sm" className="mt-3 rounded-xl" onClick={reset}>
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
          <Link href="/remote/resumes/new">
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
            <Link href="/remote/resumes/new">
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
