"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Code, Eye } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { ResumePreview, type ResumePreviewData } from "@/components/resume-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The pieces of a resume's own page, shared by base and tailored resumes so
 * the two editors cannot drift apart.
 */

/** The document itself: a live preview, or the Markdown it is written in. */
export function DocumentPane({
  draft,
  onChange,
  dirty,
}: {
  draft: string;
  onChange: (next: string) => void;
  dirty: boolean;
}) {
  const [view, setView] = useState<"preview" | "markdown">("preview");
  return (
      <Card className="min-w-0 gap-0 overflow-hidden py-0">
        <Tabs value={view} onValueChange={(v) => setView(v as "preview" | "markdown")} className="gap-0">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-2">
            <TabsList>
              <TabsTrigger value="preview" className="text-xs">
                <Eye />
                Preview
              </TabsTrigger>
              <TabsTrigger value="markdown" className="text-xs">
                <Code />
                Markdown
              </TabsTrigger>
            </TabsList>
            <span
              className={cn(
                "text-xs",
                dirty ? "text-warning font-medium" : "text-muted-foreground",
              )}
            >
              {dirty ? "Unsaved edits" : "In sync"}
            </span>
          </CardHeader>

          <TabsContent value="preview">
            <PreviewPane markdown={draft} />
          </TabsContent>

          <TabsContent value="markdown">
            <CardContent className="px-0">
              {/* field-sizing-fixed defeats the shadcn default of growing to fit
                  content: a 600-line resume would otherwise make the page itself
                  scroll and leave the panel beside it stranded at the top. */}
              <Textarea
                aria-label="Resume Markdown"
                spellCheck={false}
                value={draft}
                onChange={(e) => onChange(e.target.value)}
                className="field-sizing-fixed h-[70vh] resize-none rounded-none border-0 bg-transparent font-mono text-xs focus-visible:ring-0 dark:bg-transparent"
              />
            </CardContent>
          </TabsContent>
        </Tabs>
      </Card>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The document the Download buttons produce, drawn from the current draft -
 * unsaved edits included - so there is no need to download to see a change.
 */
export function PreviewPane({ markdown }: { markdown: string }) {
  const [profile, setProfile] = useState<ResumePreviewData["profile"]>("designed");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const source = useDebounced(markdown, 400);

  const preview = useQuery({
    queryKey: ["resume-preview", profile, source],
    queryFn: () =>
      request<ResumePreviewData>("/api/v1/export/preview", {
        method: "POST",
        body: JSON.stringify({ content_markdown: source, profile }),
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Mid-edit markdown often fails to parse; keep the last good render on
  // screen rather than blanking the page on every keystroke.
  const [lastGood, setLastGood] = useState<ResumePreviewData | null>(null);
  useEffect(() => {
    if (preview.data && !preview.isPlaceholderData) setLastGood(preview.data);
  }, [preview.data, preview.isPlaceholderData]);
  const shown = preview.data ?? lastGood;

  const error = preview.error as { message?: string; detail?: Record<string, unknown> } | null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <Tabs
          value={profile}
          onValueChange={(v) => setProfile(v as ResumePreviewData["profile"])}
        >
          <TabsList>
            <TabsTrigger value="designed" className="text-xs">
              Designed
            </TabsTrigger>
            <TabsTrigger value="ats_plain" className="text-xs">
              ATS version
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-muted-foreground text-xs tabular-nums">
          {preview.isFetching || source !== markdown
            ? "Updating…"
            : pageCount !== null && `${pageCount} ${pageCount === 1 ? "page" : "pages"} · Letter`}
        </span>
      </div>

      {error && !preview.isFetching && (
        <div className="border-b px-3 py-2">
          <ErrorAlert>
            {error.detail?.line
              ? `${error.message} (line ${error.detail.line} in ${error.detail.section})`
              : (error.message ?? "Could not render the preview")}
            {shown && " — showing the last version that rendered."}
          </ErrorAlert>
        </div>
      )}

      <div className="bg-muted/60 h-[70vh] overflow-y-auto p-4 sm:p-6">
        {shown ? (
          <ResumePreview data={shown} onPageCount={setPageCount} />
        ) : (
          !error && <Skeleton className="mx-auto aspect-[8.5/11] w-full max-w-[816px]" />
        )}
      </div>
    </div>
  );
}

export function PanelNote({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-4 py-6 text-sm">{children}</p>;
}

export function AtsPanel({ report }: { report: Record<string, unknown> | null }) {
  if (!report) {
    return (
      <PanelNote>
        No ATS report — generate or tailor this resume against a job description to get one.
      </PanelNote>
    );
  }
  const rows = (report.keywords as Array<Record<string, unknown>>) ?? [];
  const stat = (k: string) => String(report[k] ?? "—");

  return (
    <div className="min-w-0">
      <dl className="bg-border grid grid-cols-2 gap-px border-b text-sm">
        {[
          [
            "MUST-HAVE coverage",
            `${stat("must_have_covered")}/${stat("must_have_total")} · ${stat("must_have_coverage_percent")}%`,
          ],
          ["Nice-to-have", `${stat("nice_to_have_coverage_percent")}%`],
          ["Years required / shown", `${stat("years_required")} / ${stat("years_shown")}`],
          [
            "Scenario gate",
            `${stat("scenario_gate_passed")}/${stat("scenario_gate_total")}`,
          ],
          ["Parse integrity", stat("parse_integrity")],
          ["Companies · categories", `${stat("companies")} · ${stat("skill_categories")}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-card px-4 py-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {rows.length > 0 && (
        <ScrollArea className="h-72">
          <Table className="text-xs">
            <TableHeader className="bg-muted sticky top-0 z-10">
              <TableRow>
                {["Keyword", "Priority", "Skills", "Experience", "Summary"].map((h) => (
                  <TableHead key={h} className="h-8">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i} className={row.covered ? undefined : "bg-destructive/5"}>
                  <TableCell className="py-1.5">{String(row.keyword)}</TableCell>
                  <TableCell className="py-1.5">{String(row.priority)}</TableCell>
                  {(["skills", "experience", "summary"] as const).map((k) => (
                    <TableCell key={k} className="py-1.5">
                      {row[k] ? "yes" : "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      <p className="text-muted-foreground border-t px-4 py-2 text-xs">
        Every count here is computed from the parsed resume, not written by the model — so
        it cannot disagree with the document.
      </p>
    </div>
  );
}

export function JsonPanel({ value, empty }: { value: unknown; empty: string }) {
  if (!value) return <PanelNote>{empty}</PanelNote>;
  return (
    <ScrollArea className="h-96">
      <pre className="min-w-0 px-4 py-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </ScrollArea>
  );
}

export interface Flags {
  must_verify?: string[];
  interview_probes?: { question: string; suggested_answer: string }[];
  estimated_figures?: { figure: string; where: string; derivation: string }[];
  uncovered_requirements?: { requirement: string; how_to_close: string }[];
  notes?: string;
}

/**
 * The interview-prep block, rendered rather than dumped.
 *
 * This is the sheet you read before a call, so raw JSON is the wrong shape for
 * it. The original object stays available underneath for anything the schema
 * does not cover.
 */
export function PrepPanel({ value, empty }: { value: Flags | null; empty: string }) {
  if (!value) return <PanelNote>{empty}</PanelNote>;

  const sections: [string, React.ReactNode][] = [];

  if (value.must_verify?.length) {
    sections.push([
      "Verify before sending",
      <ul key="verify" className="list-disc space-y-1 pl-5">
        {value.must_verify.map((item, i) => (
          <li key={i} className="break-words">
            {item}
          </li>
        ))}
      </ul>,
    ]);
  }

  if (value.interview_probes?.length) {
    sections.push([
      "Questions this timeline invites",
      <dl key="probes" className="space-y-3">
        {value.interview_probes.map((probe, i) => (
          <div key={i}>
            <dt className="font-medium break-words">{probe.question}</dt>
            <dd className="text-muted-foreground mt-0.5 break-words">
              {probe.suggested_answer}
            </dd>
          </div>
        ))}
      </dl>,
    ]);
  }

  if (value.estimated_figures?.length) {
    sections.push([
      "Every number, and where it came from",
      <ul key="figures" className="space-y-2">
        {value.estimated_figures.map((figure, i) => (
          <li key={i} className="break-words">
            <span className="font-mono font-medium">{figure.figure}</span>
            {figure.where && (
              <span className="text-muted-foreground"> · {figure.where}</span>
            )}
            {figure.derivation && (
              <span className="text-muted-foreground block">{figure.derivation}</span>
            )}
          </li>
        ))}
      </ul>,
    ]);
  }

  if (value.uncovered_requirements?.length) {
    sections.push([
      "Not covered by this resume",
      <ul key="gaps" className="space-y-2">
        {value.uncovered_requirements.map((gap, i) => (
          <li key={i} className="break-words">
            {gap.requirement}
            {gap.how_to_close && (
              <span className="text-muted-foreground block">{gap.how_to_close}</span>
            )}
          </li>
        ))}
      </ul>,
    ]);
  }

  if (!sections.length) return <JsonPanel value={value} empty={empty} />;

  return (
    <ScrollArea className="h-[32rem]">
      <div className="min-w-0">
        {sections.map(([heading, body]) => (
          <section key={heading} className="border-b px-4 py-3 last:border-0">
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
              {heading}
            </h3>
            <div className="space-y-1 text-sm">{body}</div>
          </section>
        ))}
        {value.notes && (
          <p className="text-muted-foreground border-t px-4 py-3 text-sm break-words">
            {value.notes}
          </p>
        )}
        <Collapsible className="border-t px-2 py-1">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="text-muted-foreground">
              Raw data
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="min-w-0 px-2 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
              {JSON.stringify(value, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ScrollArea>
  );
}
