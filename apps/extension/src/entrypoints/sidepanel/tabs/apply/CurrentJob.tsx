import { Download, ExternalLink, FormInput, Globe, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { hostOf, isInjectable } from "@/lib/page";
import type { LinkedResume, ResumeKind, ResumeRef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyNote } from "../../chrome-shell";
import { ErrorNote, PanelField, Progress } from "../../components";
import { fillApplication, type FillReport } from "./fill-application";
import { FillReportCard } from "./FillReport";
import { ResumeDetails } from "./ResumeDetails";
import type { JobRow, Strategy } from "./use-job-board";

export interface ResumeOption {
  kind: ResumeKind;
  id: string;
  display_name: string;
  company_name?: string | null;
}

interface FillState {
  phase: { label: string; percent: number } | null;
  error: string | null;
  report: FillReport | null;
}

const NO_FILL: FillState = { phase: null, error: null, report: null };

/**
 * The active tab: its posting, the resume it uses, and what to do with both.
 *
 * Every action here is against this one tab, so what the tab is comes first.
 */
export function CurrentJob({
  row,
  resumes,
  baseResumeId,
  strategy,
  portalUrl,
  onTailor,
  onLink,
  onDownload,
}: {
  row: JobRow | null;
  resumes: ResumeOption[];
  baseResumeId: string;
  strategy: Strategy;
  portalUrl: string;
  onTailor: (row: JobRow) => void;
  onLink: (row: JobRow, resume: ResumeRef | null) => Promise<void>;
  onDownload: (row: JobRow) => Promise<void>;
}) {
  // Per tab, so switching away and back still shows what the fill did there.
  const [fills, setFills] = useState<Record<number, FillState>>({});
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"link" | "download" | "save" | null>(null);
  const [failure, setFailure] = useState<{ tabId: number; message: string } | null>(null);

  if (!row) return <EmptyNote icon={Globe}>Open a job posting in this window.</EmptyNote>;

  const current = row;
  const { tab, link, run } = current;
  const readable = isInjectable(tab.url);
  const resume = link?.resume ?? null;
  const running = Boolean(run?.running);
  const fill = fills[tab.tabId];
  const filling = Boolean(fill?.phase);
  const postingKey = link?.job_key ?? tab.url;
  // A tailored resume knows its application, so reopening the panel cannot save
  // it twice. A base resume has no such link; this session remembers those.
  const saved = tracked.has(postingKey) || Boolean(resume?.application_id);

  function setFill(tabId: number, patch: Partial<FillState>) {
    setFills((all) => ({ ...all, [tabId]: { ...(all[tabId] ?? NO_FILL), ...patch } }));
  }

  async function fillForm() {
    // The fill finishes against the tab it started on, whatever is active by then.
    const target = tab;
    setFill(target.tabId, { phase: { label: "Starting", percent: 2 }, error: null });
    try {
      const report = await fillApplication(target, { resume, baseResumeId }, (label, percent) =>
        setFill(target.tabId, { phase: { label, percent } }),
      );
      setFill(target.tabId, { phase: null, report });
    } catch (e) {
      setFill(target.tabId, { phase: null, error: (e as Error).message });
    }
  }

  async function act(name: "link" | "download" | "save", work: () => Promise<void>) {
    setBusy(name);
    setFailure(null);
    try {
      await work();
    } catch (e) {
      setFailure({ tabId: tab.tabId, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function choose(value: string) {
    const [kind, id] = value.split(":");
    void act("link", () =>
      onLink(current, value === "none" ? null : { kind: kind as ResumeKind, id }),
    );
  }

  function save() {
    void act("save", async () => {
      await api("/api/v1/extension/save-application", {
        method: "POST",
        body: JSON.stringify({
          tailored_resume_id: resume?.kind === "tailored" ? resume.id : null,
          company_name: (link?.company_name ?? resume?.company_name ?? hostOf(tab.url)).slice(0, 160),
          role_title:
            (link?.job_title ?? resume?.job_title ?? tab.title).slice(0, 160) || "Unknown role",
          job_url: tab.url,
        }),
      });
      setTracked((all) => new Set(all).add(postingKey));
    });
  }

  const options = withLinked(resumes, resume);
  const company = (link?.company_name ?? "").toLowerCase();
  const tailoredOptions = options
    .filter((o) => o.kind === "tailored")
    // Resumes tailored for this company first.
    .sort(
      (a, b) =>
        Number(Boolean(company) && (b.company_name ?? "").toLowerCase() === company) -
        Number(Boolean(company) && (a.company_name ?? "").toLowerCase() === company),
    );
  const baseOptions = options.filter((o) => o.kind === "base");

  return (
    <div className="flex flex-col gap-2">
      <Card className="gap-0 py-0">
        <CardContent className="space-y-3 p-3">
          <TabHeading row={current} readable={readable} />

          {readable && (
            <PanelField label="Resume for this job" hint={resumeHint(resume)}>
              {(control) => (
                <Select
                  value={resume ? `${resume.kind}:${resume.id}` : ""}
                  onValueChange={choose}
                  disabled={busy === "link" || running}
                >
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue placeholder="None yet — tailor one, or pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {tailoredOptions.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Tailored</SelectLabel>
                        {tailoredOptions.map((o) => (
                          <SelectItem key={o.id} value={`tailored:${o.id}`}>
                            {o.display_name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {tailoredOptions.length > 0 && baseOptions.length > 0 && <SelectSeparator />}
                    {baseOptions.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Use as it is, without tailoring</SelectLabel>
                        {baseOptions.map((o) => (
                          <SelectItem key={o.id} value={`base:${o.id}`}>
                            {o.display_name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {resume && (
                      <>
                        <SelectSeparator />
                        <SelectItem value="none">Unlink this resume</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              )}
            </PanelField>
          )}

          {run?.running && <Progress label={run.label} percent={run.percent} />}
          {run?.error && <ErrorNote>{run.error}</ErrorNote>}

          <div className="space-y-1.5">
            <Button
              variant="brand"
              className="h-10 w-full"
              disabled={!baseResumeId || !readable || running}
              onClick={() => onTailor(current)}
            >
              {running ? <Spinner /> : <Sparkles />}
              Tailor &amp; download
            </Button>
            <p className="text-subtle text-center text-[10px] leading-snug">
              {strategy === "full"
                ? "Builds a new resume for this posting from your base resume, and saves the .docx."
                : "Reframes your base resume against this posting, and saves the .docx."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Button
              variant="outline"
              className="h-10 w-full"
              disabled={!readable || filling}
              onClick={fillForm}
            >
              {filling ? <Spinner /> : <FormInput />}
              Fill the application form
            </Button>
            <p className="text-subtle text-center text-[10px] leading-snug">
              {resume
                ? "Answers from this job's resume, and attaches it where the form asks for one."
                : "Answers what it can and hands you the rest, ready to copy."}
            </p>
          </div>

          {resume && (
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy === "download"}
                onClick={() => void act("download", () => onDownload(current))}
              >
                {busy === "download" ? <Spinner /> : <Download />}
                Download
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={saved || busy === "save"}
                onClick={save}
              >
                {saved ? "Tracked" : "Save & track"}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                asChild
                aria-label="Open your applications in the web portal"
              >
                <a href={`${portalUrl}/applications`} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            </div>
          )}

          {fill?.phase && <Progress label={fill.phase.label} percent={fill.phase.percent} />}
          {fill?.error && <ErrorNote>{fill.error}</ErrorNote>}
          {failure?.tabId === tab.tabId && <ErrorNote>{failure.message}</ErrorNote>}
        </CardContent>
      </Card>

      {fill?.report && (
        <FillReportCard
          report={fill.report}
          portalUrl={portalUrl}
          busy={filling}
          onRescan={() => void fillForm()}
        />
      )}
      {resume && <ResumeDetails resume={resume} />}
    </div>
  );
}

function TabHeading({ row, readable }: { row: JobRow; readable: boolean }) {
  const { tab, link } = row;
  const host = hostOf(tab.url);
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          readable ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Globe className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={tab.title || tab.url}>
          {(link?.job_title ?? tab.title) || host}
        </p>
        <p className="text-subtle truncate text-[11px]">
          {link?.company_name ? `${link.company_name} · ${host}` : host}
        </p>
        {!readable && (
          <p className="text-warning mt-1 text-[10px] leading-snug">
            This page cannot be read. Open the posting itself and try again.
          </p>
        )}
      </div>
    </div>
  );
}

function resumeHint(resume: LinkedResume | null): string {
  if (!resume) return "Tailor one below, or pick a resume you already have.";
  if (resume.kind === "base") return "Used as it is, without tailoring.";
  const coverage = resume.must_have_coverage_percent;
  return coverage === null
    ? "Tailored for this posting."
    : `Tailored for this posting · ${Math.round(coverage)}% of must-haves covered.`;
}

/** The picker's options, with the linked resume in them even when it is not recent. */
function withLinked(options: ResumeOption[], linked: LinkedResume | null): ResumeOption[] {
  if (!linked || options.some((o) => o.kind === linked.kind && o.id === linked.id)) {
    return options;
  }
  return [
    {
      kind: linked.kind,
      id: linked.id,
      display_name: linked.display_name,
      company_name: linked.company_name,
    },
    ...options,
  ];
}
