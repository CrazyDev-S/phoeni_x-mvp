"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileDown, FileText, Save, Sparkles } from "lucide-react";
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
  PrepPanel,
  type Flags,
} from "@/components/resume-editor";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
    queryFn: () => request<Resume>(`/api/v1/resumes/${id}`),
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
      request<Resume & { findings: Finding[] }>(`/api/v1/resumes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content_markdown }),
      }),
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

  return (
    <div className="space-y-8">
      <PageHero
        size="page"
        eyebrow={data.mode === "constructed" ? "Constructed scenario" : "Base resume"}
        eyebrowIcon={FileText}
        title={
          <>
            {data.display_name}
            {data.status === "needs_review" && (
              <StatusBadge tone="warn">Needs review</StatusBadge>
            )}
          </>
        }
        description={data.target_title}
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              className="h-11"
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
                  size="lg"
                  className="h-11"
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
            {(errorCount > 0 || upgrade.state.running) && (
              <Button
                variant="outline"
                size="lg"
                className="h-11"
                disabled={dirty || upgrade.state.running}
                title={
                  dirty
                    ? "Save or discard your edits first — Upgrade fixes the saved version"
                    : "Rewrite the resume until every rule error is fixed"
                }
                onClick={() => upgrade.start(`/api/v1/resumes/${id}/repair`, {})}
              >
                {upgrade.state.running ? <Spinner /> : <Sparkles />}
                {upgrade.state.running
                  ? "Upgrading…"
                  : `Upgrade · ${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
              </Button>
            )}
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
              onDelete={(cascade) =>
                request(`/api/v1/resumes/${id}${cascade ? "?cascade=true" : ""}`, {
                  method: "DELETE",
                }).then(() => undefined)
              }
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ["resumes"] });
                router.replace("/resumes");
              }}
            />
          </>
        }
      />

      {saveError && <ErrorAlert>{saveError}</ErrorAlert>}

      {(upgrade.state.running || upgrade.state.error) && (
        <GenerationProgress state={upgrade.state} />
      )}
      {!upgrade.state.running && upgrade.state.resultId && (
        <p
          className={cn(
            "text-sm",
            upgrade.state.needsReview ? "text-warning" : "text-muted-foreground",
          )}
        >
          {upgrade.state.needsReview
            ? "Upgrade fixed what it could, but some rule errors remain — see Rules. Run Upgrade again, or edit them by hand."
            : "Upgrade complete — every rule error is fixed."}
        </p>
      )}

      {/* min-w-0 on both tracks is load-bearing: a grid `1fr` is
          `minmax(auto, 1fr)`, and `auto` resolves to min-content — so one wide
          child (the JSON block) expands its column and crushes the other. */}
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
              <TabsTrigger value="ledger" className="text-xs">
                Ledger
              </TabsTrigger>
              <TabsTrigger value="flags" className="text-xs">
                Prep
              </TabsTrigger>
            </TabsList>

            <TabsContent value="validation">
              <FindingsList findings={findings} />
            </TabsContent>
            <TabsContent value="ats">
              <AtsPanel report={data.ats_report} />
            </TabsContent>
            <TabsContent value="ledger">
              <JsonPanel
                value={data.ledger}
                empty="No scenario ledger — this resume was uploaded, not generated."
              />
            </TabsContent>
            <TabsContent value="flags">
              <PrepPanel
                value={data.flags as Flags | null}
                empty="No interview-prep block for this resume."
              />
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
