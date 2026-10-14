"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Download,
  FileDown,
  Folder,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDelete } from "@/components/confirm-delete";
import { ErrorAlert } from "@/components/error-alert";
import { FindingsList, type Finding } from "@/components/remote/findings";
import { GenerationProgress } from "@/components/remote/generation-progress";
import {
  AtsPanel,
  DocumentPane,
  JsonPanel,
  PrepPanel,
  type Flags,
} from "@/components/remote/resume-editor";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/tile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
      <div className="space-y-6" aria-busy>
        <div className="flex items-center gap-5">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-6 w-72 rounded-full" />
            <Skeleton className="h-9 w-96 max-w-full" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Skeleton className="h-[32rem] rounded-[2rem]" />
          <Skeleton className="h-[32rem] rounded-[2rem]" />
        </div>
      </div>
    );
  }

  const findings = data.validation?.findings ?? [];
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const dirty = draft !== data.content_markdown;

  const upgradeBlock = errorCount > 0 || upgrade.state.running;

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <Link
          href="/remote/resumes"
          aria-label="Back"
          className="bg-card shadow-card focus-visible:ring-ring/40 grid size-14 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge className="h-7 gap-1.5 px-3 text-[0.8125rem]">
              <Folder />
              {data.mode === "constructed"
                ? "Constructed scenario"
                : "Base resume"}
            </Badge>
            <span className="text-muted-foreground text-sm font-medium">
              {data.target_title}
            </span>
            {data.status === "needs_review" && (
              <Badge variant="warning">Needs review</Badge>
            )}
          </div>
          <h1 className="page-title page-title-sm !whitespace-normal text-balance [overflow-wrap:anywhere] max-md:!text-[1.625rem]">
            {data.display_name}
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* Outline once saved: a faded primary reads as broken, not done. */}
          <Button
            variant={dirty ? "default" : "secondary"}
            size="lg"
            className="disabled:opacity-100"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {save.isPending ? <Spinner /> : dirty ? <Save /> : <Check />}
            {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
          <Button asChild variant="brand" size="lg">
            <Link href="/remote/tailor">
              <Sparkles />
              Tailor
            </Link>
          </Button>
          <ConfirmDelete
            label={data.display_name}
            trigger={
              <Button
                variant="default"
                size="icon-lg"
                aria-label="Delete resume"
              >
                <Trash2 />
              </Button>
            }
            onDelete={(cascade) =>
              request(
                `/api/v1/remote/resumes/${id}${cascade ? "?cascade=true" : ""}`,
                {
                  method: "DELETE",
                },
              ).then(() => undefined)
            }
            onDeleted={() => {
              queryClient.invalidateQueries({ queryKey: ["resumes"] });
              router.replace("/remote/resumes");
            }}
          />
        </div>
      </header>

      {saveError && <ErrorAlert>{saveError}</ErrorAlert>}

      {(upgrade.state.running || upgrade.state.error) && (
        <GenerationProgress state={upgrade.state} />
      )}
      {!upgrade.state.running && upgrade.state.resultId && (
        <p
          className={cn(
            "text-sm font-medium",
            upgrade.state.needsReview
              ? "text-warning"
              : "text-muted-foreground",
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <DocumentPane
          draft={draft}
          onChange={setDraft}
          dirty={dirty}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-[2.375rem] px-4"
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
                    className="h-[2.375rem] px-4"
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
            </>
          }
        />

        <Card className="min-w-0 gap-0 self-start overflow-hidden py-0">
          <Tabs defaultValue="validation" className="gap-0">
            <div className="border-b p-4">
              <TabsList className="bg-soft h-auto w-full gap-0.5 p-1 shadow-none group-data-horizontal/tabs:h-auto">
                {[
                  ["validation", `Rules`, findings.length],
                  ["ats", "ATS report", 0],
                  ["ledger", "Ledger", 0],
                  ["flags", "Prep", 0],
                ].map(([value, label, count]) => (
                  <TabsTrigger
                    key={value}
                    value={String(value)}
                    className="group/tab data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-9 px-2 text-[0.8125rem] sm:text-sm"
                  >
                    {label}
                    {Number(count) > 0 && (
                      <span className="rounded-full bg-black/10 px-1.5 text-xs font-bold group-data-[state=active]/tab:bg-white/20">
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

          {upgradeBlock && (
            <div className="bg-soft border-t px-6 pt-5 pb-6">
              <div className="flex items-start gap-3">
                <Tile icon={Sparkles} size="sm" />
                <div>
                  <p className="text-[0.9375rem] font-bold">
                    Upgrade fixes the saved version
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-relaxed font-medium">
                    Rewrites the resume until every rule error is fixed. Errors
                    block the extension’s one-click download.
                  </p>
                </div>
              </div>
              <Button
                variant="brand"
                size="lg"
                className="mt-4 h-12 w-full"
                disabled={dirty || upgrade.state.running}
                title={
                  dirty
                    ? "Save or discard your edits first — Upgrade fixes the saved version"
                    : "Rewrite the resume until every rule error is fixed"
                }
                onClick={() =>
                  upgrade.start(`/api/v1/remote/resumes/${id}/repair`, {})
                }
              >
                {upgrade.state.running ? <Spinner /> : <Sparkles />}
                {upgrade.state.running
                  ? "Upgrading…"
                  : `Upgrade · ${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
