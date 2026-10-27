"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileDown, RefreshCw, Save, Trash2, WandSparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDelete } from "@/components/confirm-delete";
import { ErrorAlert } from "@/components/error-alert";
import { PageHero } from "@/components/page-hero";
import { Panel } from "@/components/panel";
import { FindingsList, type Finding } from "@/components/remote/findings";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { PdfButton } from "@/components/remote/pdf-button";
import { PrepTab } from "@/components/remote/prep-tab";
import {
  AtsPanel,
  DocumentPane,
  JsonPanel,
  PanelNote,
  type Flags,
} from "@/components/remote/resume-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const SAVE_FIRST = "Save or discard your edits first. Upgrades start from the saved version.";

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
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)]">
          <Skeleton className="h-[32rem]" />
          <Skeleton className="h-[32rem]" />
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
  const pct = (value: number | null) => (value != null ? `${Math.round(value)}%` : "-");

  const facts: [string, string][] = [
    [
      "Must-have coverage",
      scored ? `${pct(data.must_have_coverage_percent)} (${data.must_have_covered}/${data.must_have_total})` : "Not scored",
    ],
    ["Nice-to-have", pct(data.nice_to_have_coverage_percent)],
    ["Years asked / shown", `${data.years_required ?? "-"} / ${data.years_shown ?? "-"}`],
    ["Rule errors", String(errorCount)],
  ];

  return (
    <div className="space-y-3">
      <PageHero
        title={data.display_name}
        back="/remote/resumes"
        badge={
          <>
            <Badge variant="brand">Tailored</Badge>
            {data.status === "needs_review" && <Badge variant="warning">Needs review</Badge>}
          </>
        }
        description={
          <span className="inline-flex items-center gap-3">
            {subtitle || "Tailored version"}
            {data.job_url && (
              <a href={data.job_url} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
                Job posting
              </a>
            )}
            <Link href={`/remote/resumes/${data.base_resume_id}`} className="text-foreground hover:underline">
              Base resume
            </Link>
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadDocx(
                  { resume_id: id, kind: "tailored", profile: "designed" },
                  `${data.display_name}.docx`,
                )
              }
            >
              <Download />
              .docx
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Single column, no table: for Workday and Taleo upload forms"
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
            <PdfButton
              variant="outline"
              size="sm"
              body={{ resume_id: id, kind: "tailored", profile: "designed" }}
              filename={`${data.display_name}.pdf`}
            >
              PDF
            </PdfButton>
            <Button
              className="disabled:opacity-100"
              disabled={!dirty || save.isPending}
              variant={dirty ? "default" : "outline"}
              onClick={() => save.mutate(draft)}
            >
              {save.isPending ? <Spinner /> : dirty ? <Save /> : <Check />}
              {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
            <ConfirmDelete
              label={data.display_name}
              trigger={
                <Button variant="outline" size="icon" aria-label="Delete resume">
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
          </>
        }
      />

      <Panel className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-1.5">
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          {facts.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd
                className={cn(
                  "font-semibold tabular-nums",
                  label === "Rule errors" && errorCount > 0 && "text-destructive",
                )}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={dirty || running}
            title={dirty ? SAVE_FIRST : "Keep employers, titles and dates; rewrite for this posting's keywords"}
            onClick={() => startUpgrade("existing")}
          >
            {running && strategy === "existing" ? <Spinner /> : <RefreshCw />}
            Upgrade existing
          </Button>
          <Button
            size="sm"
            disabled={dirty || running}
            title={dirty ? SAVE_FIRST : "Build a new resume from the job description"}
            onClick={() => startUpgrade("full")}
          >
            {running && strategy === "full" ? <Spinner /> : <WandSparkles />}
            Full upgrade
          </Button>
        </div>
      </Panel>

      {(running || upgrade.state.error) && (
        <GenerationProgress state={upgrade.state} onStop={upgrade.stop} />
      )}
      {!running && upgrade.state.resultId && (
        <p className={cn("text-xs", upgrade.state.needsReview ? "text-warning" : "text-muted-foreground")}>
          {upgrade.state.needsReview
            ? "Upgraded, but some rule errors remain. See Rules."
            : "Upgrade complete: the new version is loaded below."}
        </p>
      )}

      {saveError && <ErrorAlert>{saveError}</ErrorAlert>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)] lg:items-start">
        <DocumentPane draft={draft} onChange={setDraft} dirty={dirty} />

        <Panel className="self-start overflow-hidden">
          <Tabs defaultValue="validation" className="gap-0">
            <div className="border-b px-3 py-2">
              <TabsList>
                {[
                  ["validation", "Rules", findings.length],
                  ["ats", "ATS report", 0],
                  ["job", "Job", 0],
                  ["flags", "Prep", 0],
                  ["ledger", "Ledger", 0],
                ].map(([value, label, count]) => (
                  <TabsTrigger key={value} value={String(value)}>
                    {label}
                    {Number(count) > 0 && (
                      <span className="bg-destructive rounded px-1 text-[11px] font-semibold text-white tabular-nums">
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
              <AtsPanel report={data.ats_report} />
            </TabsContent>
            <TabsContent value="job">
              {data.job_description_text.trim() ? (
                <ScrollArea className="h-96">
                  <p className="min-w-0 px-3 py-2 text-[13px] leading-snug break-words whitespace-pre-wrap">
                    {data.job_description_text}
                  </p>
                </ScrollArea>
              ) : (
                <PanelNote>No job description was saved with this version.</PanelNote>
              )}
            </TabsContent>
            <TabsContent value="flags">
              <PrepTab
                path={`/api/v1/remote/tailored-resumes/${id}/prep`}
                flags={data.flags as Flags | null}
                dirty={dirty}
                onDone={() => void refetch()}
              />
            </TabsContent>
            <TabsContent value="ledger">
              <JsonPanel value={data.ledger} empty="No ledger saved with this version." />
            </TabsContent>
          </Tabs>
        </Panel>
      </div>
    </div>
  );
}
