import {
  Copy,
  ExternalLink,
  FormInput,
  Globe,
  ListChecks,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, downloadDocx, waitForGeneration } from "@/lib/api";
import { BASE_RESUME_KEY } from "@/lib/constants";
import {
  activeTab,
  extractJob,
  fillForms,
  isInjectable,
  scanForms,
  type TargetTab,
} from "@/lib/page";
import type { FillResult, JobExtract, ScanResult } from "@/lib/types";
import { EmptyNote, Section } from "../chrome-shell";
import { ErrorNote, PanelField, Progress } from "../components";

interface Resume {
  id: string;
  display_name: string;
}

interface Answer {
  id: string;
  type: string;
  answer: string;
  checked?: boolean;
  needs_user_input: boolean;
  reason: string;
  matched_fuzzily: boolean;
}

export function ApplyTab({ portalUrl }: { portalUrl: string }) {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [baseId, setBaseId] = useState("");
  const [target, setTarget] = useState<TargetTab | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The operation is FROZEN against the tab it started on. Switching tabs
  // mid-run must not retarget a 90-second generation.
  const lockedTab = useRef<TargetTab | null>(null);

  const [phase, setPhase] = useState<{ label: string; percent: number } | null>(null);
  const [tailored, setTailored] = useState<{ id: string; job: JobExtract } | null>(null);

  const [fillState, setFillState] = useState<{
    results: FillResult[];
    unanswered: Answer[];
    unreachable: string[];
  } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const win = await chrome.windows.getCurrent();
      const refresh = async () => {
        if (win.id === undefined) return;
        setTarget(await activeTab(win.id));
      };
      await refresh();

      const onActivated = (info: { windowId: number }) => {
        if (info.windowId === win.id) void refresh();
      };
      const onUpdated = (_id: number, change: { url?: string; status?: string }) => {
        if (change.url || change.status === "complete") void refresh();
      };
      chrome.tabs.onActivated.addListener(onActivated);
      chrome.tabs.onUpdated.addListener(onUpdated);

      const stored = (await chrome.storage.local.get(BASE_RESUME_KEY)) as Record<
        string,
        string | undefined
      >;
      const list = await api<{ items: Resume[] }>("/api/v1/resumes").catch(() => null);
      if (list) {
        setResumes(list.items);
        setBaseId(stored[BASE_RESUME_KEY] ?? list.items[0]?.id ?? "");
      }

      return () => {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };
    })();
  }, []);

  function chooseResume(id: string) {
    setBaseId(id);
    void chrome.storage.local.set({ [BASE_RESUME_KEY]: id });
  }

  async function tailor() {
    setError(null);
    setFillState(null);
    setSaved(false);
    const tab = target;
    if (!tab || !isInjectable(tab.url)) {
      setError("Open a job posting in this window first.");
      return;
    }
    lockedTab.current = tab;

    try {
      setPhase({ label: "Reading the page", percent: 5 });
      const job = await extractJob(tab.tabId);
      if (!job || job.description_text.length < 120) {
        setError("Could not find a job description on this page.");
        setPhase(null);
        return;
      }

      setPhase({ label: "Sending to your backend", percent: 12 });
      const accepted = await api<{
        id: string;
        reused?: boolean;
        result_id?: string | null;
      }>("/api/v1/extension/tailor", {
        method: "POST",
        body: JSON.stringify({ base_resume_id: baseId, job }),
      });

      let resultId = accepted.result_id ?? null;
      if (!accepted.reused) {
        const done = await waitForGeneration(accepted.id, (label, percent) =>
          setPhase({ label, percent }),
        );
        resultId = (done.result_id as string) ?? null;

        // A resume with a banned placeholder must never reach a real
        // application in one click - push the user into the editor instead.
        const findings = (done.findings as Array<{ rule_id: string; severity: string }>) ?? [];
        const blocking = findings.filter(
          (f) =>
            f.severity === "error" &&
            (f.rule_id === "PLACEHOLDER_TOKEN" || f.rule_id === "DOSSIER_PROVENANCE"),
        );
        if (blocking.length) {
          setPhase(null);
          setError(
            `Held back: ${blocking[0].rule_id.toLowerCase().replace("_", " ")}. Open it in the portal and fix it before sending.`,
          );
          return;
        }
      } else {
        setPhase({ label: "Reused an identical recent run", percent: 100 });
      }

      if (!resultId) throw new Error("No result returned");

      setPhase({ label: "Downloading", percent: 96 });
      const name = `${job.company ?? "Resume"} - ${job.title ?? "Application"}.docx`;
      await downloadDocx({ resume_id: resultId, kind: "tailored", profile: "designed" }, name);

      setTailored({ id: resultId, job });
      setPhase({ label: "Downloaded to your Downloads folder", percent: 100 });
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
    }
  }

  async function fillBlanks() {
    setError(null);
    const tab = lockedTab.current ?? target;
    if (!tab) return;

    try {
      setPhase({ label: "Scanning the form", percent: 10 });
      const { frames, unreachableFrames } = await scanForms(tab.tabId);
      if (!frames.length) {
        setError(
          unreachableFrames.length
            ? "The form sits in a frame we cannot reach. Open it directly and try again."
            : "No fillable fields found on this page.",
        );
        setPhase(null);
        return;
      }

      setPhase({ label: "Working out the answers", percent: 40 });
      const job = tailored?.job ?? (await extractJob(tab.tabId));
      const response = await api<{ answers: Answer[]; unanswered: Answer[] }>(
        "/api/v1/extension/autofill",
        {
          method: "POST",
          body: JSON.stringify({
            base_resume_id: baseId,
            job: job ?? undefined,
            frames: frames.map((f: ScanResult) => ({
              frame_key: f.frameKey,
              url: f.url,
              fields: f.fields,
            })),
          }),
        },
      );

      setPhase({ label: "Filling the page", percent: 70 });
      const labels = new Map(
        frames.flatMap((f) => f.fields.map((x) => [x.id, x.label] as const)),
      );
      const grouped: Record<string, unknown[]> = {};
      for (const a of response.answers) {
        const key = a.id.split(":")[0];
        (grouped[key] ??= []).push({ ...a, label: labels.get(a.id) ?? "" });
      }
      const results = await fillForms(tab.tabId, grouped);

      setFillState({
        results,
        unanswered: response.unanswered.map((u) => ({
          ...u,
          reason: u.reason || "Needs you",
        })),
        unreachable: unreachableFrames,
      });
      setPhase(null);
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
    }
  }

  async function saveApplication() {
    if (!tailored) return;
    try {
      await api("/api/v1/extension/save-application", {
        method: "POST",
        body: JSON.stringify({
          tailored_resume_id: tailored.id,
          company_name: tailored.job.company ?? "Unknown company",
          role_title: tailored.job.title ?? "Unknown role",
          job_url: tailored.job.url,
          job_description_text: tailored.job.description_text.slice(0, 20_000),
          location: tailored.job.location,
        }),
      });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const running = Boolean(phase && phase.percent < 100);
  const ready = Boolean(target && isInjectable(target.url));
  const filled = fillState?.results.filter((r) => r.status === "filled").length ?? 0;
  const needsYou = [
    ...(fillState?.results.filter((r) => r.status !== "filled") ?? []),
    ...(fillState?.unanswered ?? []),
  ];

  return (
    <>
      <Section title="Target page">
        <TargetCard target={target} />
      </Section>

      <Card className="py-3">
        <CardContent className="px-3">
          <FieldGroup className="gap-3">
            <PanelField label="Base resume">
              {(control) => (
                <Select value={baseId} onValueChange={chooseResume}>
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue placeholder="Choose a resume…" />
                  </SelectTrigger>
                  <SelectContent>
                    {resumes.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </PanelField>

            <div className="space-y-1.5">
              <Button
                className="h-10 w-full"
                disabled={!baseId || !ready || running}
                onClick={tailor}
              >
                {running ? <Spinner /> : <Sparkles />}
                Tailor &amp; download
              </Button>
              <p className="text-subtle text-center text-[10px] leading-snug">
                Reframes your resume against this posting and saves the .docx.
              </p>
            </div>

            <div className="space-y-1.5">
              <Button
                variant="outline"
                className="h-10 w-full"
                disabled={!ready || running}
                onClick={fillBlanks}
              >
                <FormInput />
                Fill the application form
              </Button>
              <p className="text-subtle text-center text-[10px] leading-snug">
                Answers what it can and hands you the rest, ready to copy.
              </p>
            </div>

            {phase && <Progress label={phase.label} percent={phase.percent} />}
            {error && <ErrorNote>{error}</ErrorNote>}
          </FieldGroup>
        </CardContent>
      </Card>

      {tailored && (
        <Card className="border-success/40 py-3">
          <CardContent className="space-y-2 px-3">
            <div className="flex items-center gap-2">
              <strong className="min-w-0 flex-1 truncate text-xs">
                {tailored.job.title ?? "Tailored resume"}
              </strong>
              {saved && (
                <Badge variant="secondary" className="bg-success/10 text-success">
                  Saved
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-[11px]">
              {tailored.job.company ?? "Unknown company"}
              {tailored.job.ats && ` · ${tailored.job.ats}`}
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                className="flex-1"
                disabled={saved}
                onClick={saveApplication}
              >
                {saved ? "Tracked" : "Save & track"}
              </Button>
              <Button size="icon" variant="ghost" asChild aria-label="Open in the web portal">
                <a href={`${portalUrl}/applications`} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {fillState && (
        <Card className="py-3">
          <CardContent className="space-y-2.5 px-3">
            <div className="flex items-center gap-2">
              <strong className="flex-1 text-xs">
                Filled {filled} of {fillState.results.length + fillState.unanswered.length}
              </strong>
              <Button size="xs" variant="outline" onClick={fillBlanks}>
                Re-scan
              </Button>
            </div>

            {fillState.unreachable.length > 0 && (
              <p className="text-warning text-[11px] leading-snug">
                {fillState.unreachable.length} frame(s) could not be reached. If the form is
                embedded, open it directly:{" "}
                <a
                  href={fillState.unreachable[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline"
                >
                  open form
                  <ExternalLink className="size-2.5" />
                </a>
              </p>
            )}

            {!needsYou.length && (
              <EmptyNote icon={ListChecks}>
                Every field was answered. Check them before you submit.
              </EmptyNote>
            )}

            {needsYou.length > 0 && (
              <>
                <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                  <TriangleAlert className="text-warning size-3 shrink-0" />
                  {needsYou.length} need you — the answer is here, ready to copy:
                </p>
                <ul className="divide-y">
                  {needsYou.map((item, i) => {
                    const answer =
                      "answer" in item ? String(item.answer ?? "") : String(item.intended ?? "");
                    const label = "label" in item ? item.label : "";
                    const reverted = "status" in item && item.status === "reverted";
                    return (
                      <li key={i} className="space-y-1 py-1.5 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[11px]">
                            {label || ("id" in item ? item.id : "")}
                          </span>
                          <Badge
                            variant={reverted ? "secondary" : "destructive"}
                            className={reverted ? "bg-warning/10 text-warning" : undefined}
                          >
                            {"status" in item ? item.status : "needs you"}
                          </Badge>
                        </div>
                        {answer && (
                          <div className="flex items-center gap-1.5">
                            <code className="bg-muted min-w-0 flex-1 truncate rounded px-1.5 py-0.5 font-mono text-[10px]">
                              {answer}
                            </code>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Copy answer"
                              onClick={() => void navigator.clipboard.writeText(answer)}
                            >
                              <Copy />
                            </Button>
                          </div>
                        )}
                        {"reason" in item && item.reason && (
                          <p className="text-muted-foreground text-[10px]">{item.reason}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      needsYou
                        .map((i) => {
                          const a = "answer" in i ? i.answer : (i as FillResult).intended;
                          const l = "label" in i ? i.label : (i as Answer).id;
                          return `${l}: ${a}`;
                        })
                        .join("\n"),
                    )
                  }
                >
                  <Copy />
                  Copy all as text
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/**
 * The page the panel is aimed at.
 *
 * Every action on this tab runs against one tab in this window, so what that
 * tab is has to be the first thing on screen rather than a grey line of text.
 */
function TargetCard({ target }: { target: TargetTab | null }) {
  const ready = Boolean(target && isInjectable(target.url));

  if (!target) {
    return <EmptyNote icon={Globe}>Open a job posting in this window.</EmptyNote>;
  }

  let host = target.url;
  try {
    host = new URL(target.url).hostname.replace(/^www\./, "");
  } catch {
    // A chrome:// or file:// URL, which is not injectable anyway.
  }

  return (
    <div className="bg-card flex items-start gap-2.5 rounded-xl border p-3">
      <span
        className={
          ready
            ? "bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
            : "bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
        }
      >
        <Globe className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={target.title || target.url}>
          {target.title || host}
        </p>
        <p className="text-subtle truncate text-[11px]">{host}</p>
        {!ready && (
          <p className="text-warning mt-1 text-[10px] leading-snug">
            This page cannot be read. Open the posting itself and try again.
          </p>
        )}
      </div>
    </div>
  );
}
