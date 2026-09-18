"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Download,
  FileDown,
  RefreshCw,
  Save,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDelete } from "@/components/confirm-delete";
import { ErrorAlert } from "@/components/error-alert";
import { FindingsList, type Finding } from "@/components/findings";
import { GenerationProgress } from "@/components/generation-progress";
import { PageHero } from "@/components/page-hero";
import {
  AtsPanel,
  DocumentPane,
  JsonPanel,
  PanelNote,
  PrepPanel,
  type Flags,
} from "@/components/resume-editor";
import { StatusBadge } from "@/components/status-badge";
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
    queryFn: () => request<TailoredResume>(`/api/v1/tailored-resumes/${id}`),
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
      request<TailoredResume>(`/api/v1/tailored-resumes/${id}`, {
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
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-48" />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
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

  function startUpgrade(next: Strategy) {
    setStrategy(next);
    void upgrade.start(`/api/v1/tailored-resumes/${id}/upgrade`, { strategy: next });
  }

  const stats: [string, string][] = [
    [
      "Must-have coverage",
      data.must_have_total
        ? `${data.must_have_covered}/${data.must_have_total} · ${Math.round(data.must_have_coverage_percent ?? 0)}%`
        : "Not scored",
    ],
    [
      "Nice-to-have",
      data.nice_to_have_coverage_percent != null
        ? `${Math.round(data.nice_to_have_coverage_percent)}%`
        : "—",
    ],
    ["Years asked / shown", `${data.years_required ?? "—"} / ${data.years_shown ?? "—"}`],
    ["Rule errors", String(errorCount)],
  ];

  return (
    <div className="space-y-6">
      <PageHero
        size="page"
        eyebrow="Tailored resume"
        eyebrowIcon={Sparkles}
        title={
          <>
            {data.display_name}
            {data.status === "needs_review" && (
              <StatusBadge tone="warn">Needs review</StatusBadge>
            )}
          </>
        }
        description={
          [data.job_title, data.company_name].filter(Boolean).join(" · ") || "Tailored version"
        }
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              className="h-11"
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
              variant="outline"
              size="lg"
              className="h-11"
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
            {/* Outline once saved: a faded primary reads as broken, not done. */}
            <Button
              variant={dirty ? "default" : "outline"}
              size="lg"
              className="h-11"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              <Save />
              {dirty ? "Save changes" : "Saved"}
            </Button>
            <ConfirmDelete
              label={data.display_name}
              onDelete={() =>
                request(`/api/v1/tailored-resumes/${id}`, { method: "DELETE" }).then(
                  () => undefined,
                )
              }
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
                queryClient.invalidateQueries({ queryKey: ["application"] });
                router.replace("/resumes");
              }}
            />
          </>
        }
      />

      <div className="space-y-2">
        <dl className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border text-sm sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="bg-card px-4 py-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {data.job_url && (
            <a
              href={data.job_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-1 hover:underline"
            >
              Job posting
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
          <Link
            href={`/resumes/${data.base_resume_id}`}
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            Base resume
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </div>

      <Card className="gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Improve the match</p>
            <p className="text-muted-foreground text-sm">
              Upgrade existing keeps employers, titles and dates and rewrites for this
              posting&apos;s keywords. Full upgrade builds a new resume from the job
              description. Both replace this version.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={dirty || running}
            title={dirty ? SAVE_FIRST : undefined}
            onClick={() => startUpgrade("existing")}
          >
            {running && strategy === "existing" ? <Spinner /> : <RefreshCw />}
            Upgrade existing
          </Button>
          <Button
            disabled={dirty || running}
            title={dirty ? SAVE_FIRST : undefined}
            onClick={() => startUpgrade("full")}
          >
            {running && strategy === "full" ? <Spinner /> : <WandSparkles />}
            Full upgrade
          </Button>
        </div>
        {(running || upgrade.state.error) && <GenerationProgress state={upgrade.state} />}
        {!running && upgrade.state.resultId && (
          <p
            className={cn(
              "text-sm",
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

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <DocumentPane draft={draft} onChange={setDraft} dirty={dirty} />

        <Card className="min-w-0 gap-0 self-start overflow-hidden py-0">
          <Tabs defaultValue="validation" className="gap-0">
            <TabsList className="w-full rounded-none border-b p-1">
              <TabsTrigger value="validation" className="text-xs">
                Rules{findings.length ? ` (${findings.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="ats" className="text-xs">
                ATS report
              </TabsTrigger>
              <TabsTrigger value="job" className="text-xs">
                Job
              </TabsTrigger>
              <TabsTrigger value="flags" className="text-xs">
                Prep
              </TabsTrigger>
              <TabsTrigger value="ledger" className="text-xs">
                Ledger
              </TabsTrigger>
            </TabsList>

            <TabsContent value="validation">
              <FindingsList findings={findings} />
            </TabsContent>
            <TabsContent value="ats">
              <AtsPanel report={data.ats_report} />
            </TabsContent>
            <TabsContent value="job">
              {data.job_description_text.trim() ? (
                <ScrollArea className="h-96">
                  <p className="min-w-0 px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
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
