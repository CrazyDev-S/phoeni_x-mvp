"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Download,
  FileDown,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDelete } from "@/components/confirm-delete";
import { ErrorAlert } from "@/components/error-alert";
import { FindingsList, type Finding } from "@/components/remote/findings";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { AtsReport } from "@/components/remote/tailored/ats-report";
import {
  DocumentPane,
  JsonPanel,
  PanelNote,
  PrepPanel,
  type Flags,
} from "@/components/remote/resume-editor";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/tile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGeneration } from "@/hooks/use-generation";
import { downloadDocx, request } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TailoredResume {
  id: string;
  display_name: string;
  company_name: string | null;
  job_title: string | null;
  job_url: string | null;
  base_resume_id: string;
  status: string;
  content_markdown: string;
  job_description_text: string;
  must_have_covered: number | null;
  must_have_total: number | null;
  must_have_coverage_percent: number | null;
  nice_to_have_coverage_percent: number | null;
  years_required: number | null;
  years_shown: number | null;
  ats_report: Record<string, unknown> | null;
  ledger: Record<string, unknown> | null;
  flags: Record<string, unknown> | null;
  validation: { findings?: Finding[] } | null;
}

type Strategy = "existing" | "full";

const SAVE_FIRST = "Save or discard your edits first — upgrades start from the saved version";

/**
 * One tailored resume: review it against its posting, edit it, or have it
 * upgraded.
 *
 * Mirrors the base resume page, with the job it was written for alongside.
 * Saving re-scores it against that job's keyword plan, so the coverage figures
 * always describe the text on screen.
 */
export default function TailoredResumePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const upgrade = useGeneration();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["tailored-resume", id],
    queryFn: () => request<TailoredResume>(`/api/v1/remote/tailored-resumes/${id}`),
  });

  useEffect(() => {
    if (data && draft === null) setDraft(data.content_markdown);
  }, [data, draft]);

  // An upgrade rewrites this resume on the server. Load the new text into the
  // editor, or the old draft would read as unsaved edits.
  const upgradedId = upgrade.state.running ? null : upgrade.state.resultId;
  useEffect(() => {
    if (!upgradedId) return;
    refetch().then(({ data: fresh }) => {
      if (fresh) setDraft(fresh.content_markdown);
    });
    queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
    queryClient.invalidateQueries({ queryKey: ["application"] });
  }, [upgradedId, refetch, queryClient]);

  const save = useMutation({
    mutationFn: (content_markdown: string) =>
      request<TailoredResume>(`/api/v1/remote/tailored-resumes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content_markdown }),
      }),
    onSuccess: (updated) => {
      setSaveError(null);
      queryClient.setQueryData(["tailored-resume", id], updated);
      queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
      queryClient.invalidateQueries({ queryKey: ["application"] });
    },
    onError: (err) => {
      const e = err as { message?: string; detail?: Record<string, unknown> };
      setSaveError(
        e.detail?.line
          ? `${e.message} (line ${e.detail.line} in ${e.detail.section})`
          : (e.message ?? "Could not save"),
      );
    },
  });

  if (error) {
    return <ErrorAlert>{(error as Error).message || "Could not load this resume."}</ErrorAlert>;
  }

  if (isLoading || !data || draft === null) {
    return (
      <div className="space-y-6" aria-busy>
        <div className="flex items-center gap-5">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-5 w-48 rounded-full" />
            <Skeleton className="h-9 w-80 max-w-full" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-34 rounded-[1.875rem]" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)]">
          <Skeleton className="h-[32rem] rounded-[2rem]" />
          <Skeleton className="h-[32rem] rounded-[2rem]" />
        </div>
      </div>
    );
  }

  const findings = data.validation?.findings ?? [];
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const dirty = draft !== data.content_markdown;
  const running = upgrade.state.running;
  const scored = Boolean(data.must_have_total);

  function startUpgrade(next: Strategy) {
    setStrategy(next);
    void upgrade.start(`/api/v1/remote/tailored-resumes/${id}/upgrade`, { strategy: next });
  }

  const subtitle = [data.job_title, data.company_name].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <Link
          href="/remote/resumes"
          aria-label="Back"
          className="bg-card shadow-card focus-visible:ring-ring/40 grid size-14 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-xs font-bold tracking-[0.07em] uppercase">
              Tailored resume
            </span>
            {data.status === "needs_review" && <Badge variant="warning">Needs review</Badge>}
          </div>
          <h1 className="page-title page-title-sm !whitespace-normal !normal-case text-balance [overflow-wrap:anywhere] max-md:!text-[1.625rem]">
            {data.display_name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
            <span className="text-muted-foreground">{subtitle || "Tailored version"}</span>
            {data.job_url && (
              <a
                href={data.job_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                <ArrowUpRight className="size-[15px]" />
                Job posting
              </a>
            )}
            <Link
              href={`/remote/resumes/${data.base_resume_id}`}
              className="inline-flex items-center gap-1 hover:underline"
            >
              <ArrowUpRight className="size-[15px]" />
              Base resume
            </Link>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() =>
              downloadDocx(
                { resume_id: id, kind: "tailored", profile: "designed" },
                `${data.display_name}.docx`,
              )
            }
          >
            <Download />
            Download .docx
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() =>
              downloadDocx(
                { resume_id: id, kind: "tailored", profile: "ats_plain" },
                `${data.display_name}_ATS.docx`,
              )
            }
          >
            <FileDown />
            ATS version
          </Button>
          <Button
            size="lg"
            className="disabled:opacity-100"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {save.isPending ? (
              <Spinner />
            ) : dirty ? (
              <Save />
            ) : (
              <span className="bg-panel-raised text-brand -ml-3 grid size-8 place-items-center rounded-full">
                <Check className="size-4" />
              </span>
            )}
            {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
          <ConfirmDelete
            label={data.display_name}
            trigger={
              <Button variant="destructive" size="icon-lg" aria-label="Delete resume">
                <Trash2 />
              </Button>
            }
            onDelete={() =>
              request(`/api/v1/remote/tailored-resumes/${id}`, { method: "DELETE" }).then(
                () => undefined,
              )
            }
            onDeleted={() => {
              queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
              queryClient.invalidateQueries({ queryKey: ["application"] });
              router.replace("/remote/resumes");
            }}
          />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card tone="dark" className="min-h-34 gap-2.5 rounded-[1.875rem] px-6 py-[22px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-panel-muted text-sm font-semibold">Must-have coverage</span>
            {scored && (
              <span className="bg-panel-raised text-panel-foreground rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums">
                {data.must_have_covered} / {data.must_have_total}
              </span>
            )}
          </div>
          {scored ? (
            <div className="flex items-center gap-4">
              <span className="text-[2.75rem] leading-none font-medium tracking-tight tabular-nums">
                {Math.round(data.must_have_coverage_percent ?? 0)}%
              </span>
              <CoverageBar value={data.must_have_coverage_percent ?? 0} tone="brand" />
            </div>
          ) : (
            <span className="text-panel-muted text-lg font-medium">Not scored</span>
          )}
        </Card>

        <Card className="min-h-34 gap-2.5 rounded-[1.875rem] px-6 py-[22px]">
          <span className="text-muted-foreground text-sm font-semibold">Nice-to-have coverage</span>
          {data.nice_to_have_coverage_percent != null ? (
            <div className="flex items-center gap-4">
              <span className="text-[2.75rem] leading-none font-medium tracking-tight tabular-nums">
                {Math.round(data.nice_to_have_coverage_percent)}%
              </span>
              <CoverageBar value={data.nice_to_have_coverage_percent} tone="info" />
            </div>
          ) : (
            <span className="text-subtle text-[2.75rem] leading-none font-medium">—</span>
          )}
        </Card>

        <Card className="min-h-34 gap-2.5 rounded-[1.875rem] px-6 py-[22px]">
          <span className="text-muted-foreground text-sm font-semibold">Years asked / shown</span>
          <span className="text-[2.75rem] leading-none font-medium tracking-tight tabular-nums">
            {data.years_required ?? "—"} / {data.years_shown ?? "—"}
            <small className="text-muted-foreground ml-1.5 text-lg font-medium tracking-normal">
              years
            </small>
          </span>
        </Card>

        <Card className="min-h-34 gap-2.5 rounded-[1.875rem] px-6 py-[22px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-sm font-semibold">Rule errors</span>
            {errorCount > 0 && <Badge variant="destructive">Review</Badge>}
          </div>
          <span className="text-[2.75rem] leading-none font-medium tracking-tight tabular-nums">
            {errorCount}
          </span>
        </Card>
      </section>

      <Card tone="soft" className="gap-0 rounded-[1.875rem] px-6 py-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
          <Tile icon={Sparkles} tone="brand" size="lg" />
          <div className="min-w-[16rem] flex-1">
            <p className="text-lg font-bold">Improve the match</p>
            <p className="text-muted-foreground mt-[3px] max-w-3xl text-[0.8438rem] leading-normal font-medium">
              Upgrade existing keeps employers, titles and dates and rewrites for this
              posting&apos;s keywords. Full upgrade builds a new resume from the job description.
              Both replace this version.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="lg"
              disabled={dirty || running}
              title={dirty ? SAVE_FIRST : undefined}
              onClick={() => startUpgrade("existing")}
            >
              {running && strategy === "existing" ? <Spinner /> : <RefreshCw />}
              Upgrade existing
            </Button>
            <Button
              size="lg"
              disabled={dirty || running}
              title={dirty ? SAVE_FIRST : undefined}
              onClick={() => startUpgrade("full")}
            >
              {running && strategy === "full" ? (
                <Spinner />
              ) : (
                <WandSparkles className="text-brand" />
              )}
              Full upgrade
            </Button>
          </div>
        </div>
        {(running || upgrade.state.error) && (
          <div className="mt-4">
            <GenerationProgress state={upgrade.state} />
          </div>
        )}
        {!running && upgrade.state.resultId && (
          <p
            className={cn(
              "mt-4 text-sm font-medium",
              upgrade.state.needsReview ? "text-warning" : "text-muted-foreground",
            )}
          >
            {upgrade.state.needsReview
              ? "Upgraded, but some rule errors remain — see Rules, or edit them below."
              : "Upgrade complete — the new version is loaded below."}
          </p>
        )}
      </Card>

      {saveError && <ErrorAlert>{saveError}</ErrorAlert>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)] lg:items-start">
        <DocumentPane draft={draft} onChange={setDraft} dirty={dirty} />

        <Card className="min-w-0 gap-0 self-start overflow-hidden rounded-[2.125rem] py-0">
          <Tabs defaultValue="validation" className="gap-0">
            <div className="p-[22px] pb-4">
              <TabsList className="bg-soft h-auto w-full gap-0.5 p-1 shadow-none group-data-horizontal/tabs:h-auto">
                {[
                  ["validation", "Rules", findings.length],
                  ["ats", "ATS report", 0],
                  ["job", "Job", 0],
                  ["flags", "Prep", 0],
                  ["ledger", "Ledger", 0],
                ].map(([value, label, count]) => (
                  <TabsTrigger
                    key={value}
                    value={String(value)}
                    className="group/tab data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-[38px] px-1.5 text-[0.8125rem] sm:text-sm"
                  >
                    {label}
                    {Number(count) > 0 && (
                      <span className="bg-destructive rounded-full px-1.5 text-[0.6875rem] leading-[17px] font-bold text-white">
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="validation">
              <FindingsList findings={findings} />
            </TabsContent>
            <TabsContent value="ats">
              <AtsReport report={data.ats_report} />
            </TabsContent>
            <TabsContent value="job">
              {data.job_description_text.trim() ? (
                <ScrollArea className="h-96">
                  <p className="min-w-0 px-5 py-3 text-sm leading-relaxed font-medium break-words whitespace-pre-wrap">
                    {data.job_description_text}
                  </p>
                </ScrollArea>
              ) : (
                <PanelNote>No job description was saved with this version.</PanelNote>
              )}
            </TabsContent>
            <TabsContent value="flags">
              <PrepPanel
                value={data.flags as Flags | null}
                empty="No interview prep for this version. A full upgrade writes it."
              />
            </TabsContent>
            <TabsContent value="ledger">
              <JsonPanel value={data.ledger} empty="No ledger saved with this version." />
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function CoverageBar({ value, tone }: { value: number; tone: "brand" | "info" }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-2.5 min-w-0 flex-1 overflow-hidden rounded-full",
        tone === "brand" ? "bg-panel-raised" : "bg-foreground/10",
      )}
    >
      <div
        className={cn("h-full rounded-full", tone === "brand" ? "bg-brand" : "bg-info")}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}
