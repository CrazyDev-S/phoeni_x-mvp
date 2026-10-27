"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileDown, Save, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDelete } from "@/components/confirm-delete";
import { ErrorAlert } from "@/components/error-alert";
import { FindingsList, type Finding } from "@/components/remote/findings";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { PdfButton } from "@/components/remote/pdf-button";
import { PrepTab } from "@/components/remote/prep-tab";
import {
  AtsPanel,
  DocumentPane,
  JsonPanel,
  type Flags,
} from "@/components/remote/resume-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";
import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGeneration } from "@/hooks/use-generation";
import { downloadDocx, request } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Resume {
  id: string;
  display_name: string;
  target_title: string;
  status: string;
  mode: string;
  content_markdown: string;
  ats_report: Record<string, unknown> | null;
  ledger: Record<string, unknown> | null;
  flags: Record<string, unknown> | null;
  job_description_text: string | null;
  validation: { findings?: Finding[] } | null;
}

export default function ResumeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["resume", id],
    queryFn: () => request<Resume>(`/api/v1/remote/resumes/${id}`),
  });
  const upgrade = useGeneration();

  useEffect(() => {
    if (data && draft === null) setDraft(data.content_markdown);
  }, [data, draft]);

  // An upgrade rewrites the saved resume on the server. Load the new text into
  // the editor, or the pre-upgrade draft would read as unsaved edits.
  const upgradedId = upgrade.state.running ? null : upgrade.state.resultId;
  useEffect(() => {
    if (!upgradedId) return;
    refetch().then(({ data: fresh }) => {
      if (fresh) setDraft(fresh.content_markdown);
    });
    queryClient.invalidateQueries({ queryKey: ["resumes"] });
  }, [upgradedId, refetch, queryClient]);

  const save = useMutation({
    mutationFn: (content_markdown: string) =>
      request<Resume & { findings: Finding[] }>(
        `/api/v1/remote/resumes/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ content_markdown }),
        },
      ),
    onSuccess: (updated) => {
      setSaveError(null);
      queryClient.setQueryData(["resume", id], updated);
      queryClient.invalidateQueries({ queryKey: ["resumes"] });
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

  if (isLoading || !data || draft === null) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Skeleton className="h-[32rem]" />
          <Skeleton className="h-[32rem]" />
        </div>
      </div>
    );
  }

  const findings = data.validation?.findings ?? [];
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const dirty = draft !== data.content_markdown;

  const upgradeBlock = errorCount > 0 || upgrade.state.running;

  return (
    <div className="space-y-3">
      <PageHero
        title={data.display_name}
        back="/remote/resumes"
        badge={
          <>
            <Badge variant="secondary">
              {data.mode === "constructed" ? "Constructed scenario" : "Base resume"}
            </Badge>
            {data.status === "needs_review" && <Badge variant="warning">Needs review</Badge>}
          </>
        }
        description={data.target_title}
        actions={
          <>
            {/* Outline once saved: a faded primary reads as broken, not done. */}
            <Button
              variant={dirty ? "default" : "outline"}
              className="disabled:opacity-100"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              {save.isPending ? <Spinner /> : dirty ? <Save /> : <Check />}
              {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
            <Button asChild variant="brand">
              <Link href="/remote/tailor">
                <Sparkles />
                Tailor
              </Link>
            </Button>
            <ConfirmDelete
              label={data.display_name}
              trigger={
                <Button variant="outline" size="icon" aria-label="Delete resume">
                  <Trash2 />
                </Button>
              }
              onDelete={(cascade) =>
                request(`/api/v1/remote/resumes/${id}${cascade ? "?cascade=true" : ""}`, {
                  method: "DELETE",
                }).then(() => undefined)
              }
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ["resumes"] });
                router.replace("/remote/resumes");
              }}
            />
          </>
        }
      />

      {saveError && <ErrorAlert>{saveError}</ErrorAlert>}

      {(upgrade.state.running || upgrade.state.error) && (
        <GenerationProgress state={upgrade.state} onStop={upgrade.stop} />
      )}
      {!upgrade.state.running && upgrade.state.resultId && (
        <p
          className={cn(
            "text-xs",
            upgrade.state.needsReview
              ? "text-warning"
              : "text-muted-foreground",
          )}
        >
          {upgrade.state.needsReview
            ? "Upgrade fixed what it could, but some rule errors remain. See Rules."
            : "Upgrade complete: every rule error is fixed."}
        </p>
      )}

      {/* min-w-0 on both tracks is load-bearing: a grid `1fr` is
          `minmax(auto, 1fr)`, and `auto` resolves to min-content — so one wide
          child (the JSON block) expands its column and crushes the other. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <DocumentPane
          draft={draft}
          onChange={setDraft}
          dirty={dirty}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadDocx(
                    { resume_id: id, kind: "base", profile: "designed" },
                    `${data.display_name}.docx`,
                  )
                }
              >
                <Download />
                Download .docx
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadDocx(
                        { resume_id: id, kind: "base", profile: "ats_plain" },
                        `${data.display_name}_ATS.docx`,
                      )
                    }
                  >
                    <FileDown />
                    ATS version
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Single column, no table — for Workday and Taleo upload forms
                </TooltipContent>
              </Tooltip>
              <PdfButton
                variant="outline"
                size="sm"
                body={{ resume_id: id, kind: "base", profile: "designed" }}
                filename={`${data.display_name}.pdf`}
              >
                PDF
              </PdfButton>
            </>
          }
        />

        <Panel className="self-start overflow-hidden">
          <Tabs defaultValue="validation" className="gap-0">
            <div className="border-b px-3 py-2">
              <TabsList>
                {[
                  ["validation", "Rules", findings.length],
                  ["ats", "ATS report", 0],
                  ["ledger", "Ledger", 0],
                  ["flags", "Prep", 0],
                ].map(([value, label, count]) => (
                  <TabsTrigger key={value} value={String(value)}>
                    {label}
                    {Number(count) > 0 && (
                      <span className="bg-muted rounded px-1 text-[11px] font-semibold tabular-nums">
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
            <TabsContent value="ledger">
              <JsonPanel
                value={data.ledger}
                empty="No scenario ledger: this resume was uploaded, not generated."
              />
            </TabsContent>
            <TabsContent value="flags">
              <PrepTab
                path={`/api/v1/remote/resumes/${id}/prep`}
                flags={data.flags as Flags | null}
                dirty={dirty}
                onDone={() => void refetch()}
              />
            </TabsContent>
          </Tabs>

          {upgradeBlock && (
            <div className="bg-muted/40 border-t px-3 py-2">
              <Button
                variant="brand"
                className="w-full"
                disabled={dirty || upgrade.state.running}
                title={
                  dirty
                    ? "Save or discard your edits first. Upgrade fixes the saved version."
                    : "Rewrite the resume until every rule error is fixed"
                }
                onClick={() => upgrade.start(`/api/v1/remote/resumes/${id}/repair`, {})}
              >
                {upgrade.state.running ? <Spinner /> : <Sparkles />}
                {upgrade.state.running
                  ? "Upgrading…"
                  : `Upgrade · ${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
              </Button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
