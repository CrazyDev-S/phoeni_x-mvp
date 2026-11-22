import { ExternalLink, MessageCircleQuestion, Sparkles, Square, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, stopGeneration, waitForGeneration, wasStopped } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Section } from "../../chrome-shell";
import { ErrorNote, PanelField, Progress } from "../../components";
import { CopyButton } from "../apply/copy-button";
import type { PostingDetail } from "./Posting";

const PROPOSALS = "/api/v1/freelancing/proposals";

interface Answer {
  question: string;
  answer: string;
}

/** The slice of `ProposalOut` the panel shows. The letter is stored as pasted: Unicode-styled, not markdown. */
interface Proposal {
  id: string;
  profile_id: string | null;
  bid_type: "hourly" | "fixed" | null;
  bid_amount: number | null;
  bid_currency: string | null;
  connects_estimate: number | null;
  cover_letter_markdown: string;
  answers: Answer[];
  version_id: string | null;
}

interface Version {
  id: string;
  major: number;
  minor: number;
  document: { questions?: string[] };
}

interface Profile {
  id: string;
  name: string;
  is_default: boolean;
}

interface Run {
  /** Empty while the run is being queued. */
  generationId: string;
  label: string;
  percent: number;
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function versionLabel(v: Version): string {
  return v.minor ? `draft ${v.major}.${v.minor}` : `version ${v.major}`;
}

function terms(p: Proposal): string {
  const money =
    p.bid_amount == null
      ? null
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: p.bid_currency || "USD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(p.bid_amount);
  const bid = money && (p.bid_type === "hourly" ? `Bid ${money}/hr` : `Bid ${money} fixed`);
  const connects = p.connects_estimate != null ? `${p.connects_estimate} Connects` : null;
  return [bid, connects].filter(Boolean).join(" · ");
}

/**
 * This user's proposal for the open posting, written without leaving Upwork:
 * a first draft from the posting and a profile, then revisions by instruction.
 * The letter and each screening answer copy straight into Upwork's form.
 *
 * The writer runs on the server, so leaving the posting stops following the
 * run, not the run; coming back picks it up again.
 */
export function ProposalPanel({ job, portalUrl }: { job: PostingDetail; portalUrl: string }) {
  // undefined while loading; null when there is none yet.
  const [proposal, setProposal] = useState<Proposal | null | undefined>(undefined);
  const [versions, setVersions] = useState<Version[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrived, setArrived] = useState(false);
  const following = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  /** The proposal as stored, and the run writing its next version, if one is. */
  const reload = useCallback(async (id: string) => {
    const [next, thread] = await Promise.all([
      api<Proposal>(`${PROPOSALS}/${id}`),
      api<{ items: Version[]; running_generation_id: string | null }>(`${PROPOSALS}/${id}/versions`),
    ]);
    setProposal(next);
    setVersions(thread.items);
    return thread.running_generation_id;
  }, []);

  const follow = useCallback(
    async (generationId: string, proposalId: string) => {
      following.current?.abort();
      const control = new AbortController();
      following.current = control;
      setRun({ generationId, label: "Starting the writer", percent: 2 });
      let landed = false;
      try {
        await waitForGeneration(
          generationId,
          (label, percent) => setRun({ generationId, label: label || "Writing", percent }),
          control.signal,
        );
        landed = true;
      } catch (e) {
        if (control.signal.aborted) return;
        if (!wasStopped(e)) setError(message(e, "The writer failed. Try again."));
      }
      if (control.signal.aborted) return;
      await reload(proposalId).catch(() => undefined);
      setRun(null);
      if (landed) {
        setInstruction("");
        setArrived(true);
      }
    },
    [reload],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [mine, profs] = await Promise.all([
          api<{ items: Proposal[] }>(`${PROPOSALS}?job_id=${job.id}&limit=1`),
          api<Profile[]>("/api/v1/freelancing/profiles"),
        ]);
        if (!live) return;
        const latest = mine.items[0] ?? null;
        setProfiles(profs);
        setProfileId(latest?.profile_id ?? (profs.find((p) => p.is_default) ?? profs[0])?.id ?? "");
        setProposal(latest);
        if (!latest) return;
        const running = await reload(latest.id);
        if (live && running) void follow(running, latest.id);
      } catch (e) {
        if (!live) return;
        setProposal(null);
        setError(message(e, "Could not load your proposal."));
      }
    })();
    return () => {
      live = false;
      following.current?.abort();
    };
  }, [job.id, reload, follow]);

  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(() => setArrived(false), 1600);
    return () => clearTimeout(timer);
  }, [arrived]);

  // A proposal whose first draft was stopped has no letter: it starts again, in place.
  const letter = proposal?.cover_letter_markdown.trim() ? proposal : null;
  const active = letter ? versions.find((v) => v.id === letter.version_id) : undefined;
  const questions = active?.document.questions ?? [];
  const answers = letter?.answers.filter((a) => a.answer.trim()) ?? [];
  const ready = !run && (letter ? instruction.trim().length > 0 : true);

  async function write() {
    if (!ready) return;
    setError(null);
    setRun({ generationId: "", label: "Starting the writer", percent: 1 });
    try {
      const queued = await api<{ id: string; proposal_id: string }>(`${PROPOSALS}/generate`, {
        method: "POST",
        body: JSON.stringify({
          job_id: job.id,
          profile_id: profileId || null,
          proposal_id: proposal?.id ?? null,
          based_on_id: letter?.version_id ?? null,
          current: letter ? { cover_letter_markdown: letter.cover_letter_markdown, answers: letter.answers } : null,
          instruction: instruction.trim() || null,
        }),
      });
      void follow(queued.id, queued.proposal_id);
    } catch (e) {
      setRun(null);
      setError(message(e, "Could not start the writer."));
    }
  }

  async function stop() {
    if (!run?.generationId) return;
    await stopGeneration(run.generationId).catch((e) => setError(message(e, "Could not stop the writer.")));
  }

  function answer(question: string) {
    setInstruction((text) => `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${question}\n→ `);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  return (
    <Section
      title="Proposal"
      action={
        proposal && (
          <a
            href={`${portalUrl}/freelancing/proposals/${proposal.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
          >
            Edit in portal
            <ExternalLink className="size-3" />
          </a>
        )
      }
    >
      {proposal === undefined ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : (
        <>
          {letter && (
            <div
              key={letter.version_id ?? "letter"}
              className={cn("space-y-2", arrived && "animate-in fade-in-0 slide-in-from-bottom-2 duration-500")}
            >
              <Writing
                title={active ? `Cover letter · ${versionLabel(active)}` : "Cover letter"}
                text={letter.cover_letter_markdown}
                copyLabel="cover letter"
                note={terms(letter)}
                glow={arrived}
              />
              {answers.map((a, i) => (
                <Writing key={i} title={a.question} text={a.answer} copyLabel={`answer ${i + 1}`} />
              ))}
            </div>
          )}

          {questions.length > 0 && !run && (
            <div className="border-primary/20 bg-accent/60 space-y-1 rounded-xl border p-2">
              <p className="inline-flex items-center gap-1.5 px-1 text-[11px] font-medium">
                <MessageCircleQuestion className="text-primary size-3.5" />
                The writer asks
              </p>
              {questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => answer(q)}
                  className="hover:bg-background/80 block w-full rounded-md px-1.5 py-1 text-left text-[11px] leading-snug transition-colors"
                  title="Answer it in the next instruction"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <Card className="py-0">
            <CardContent className="space-y-2.5 p-3">
              {!letter && profiles.length > 1 && (
                <PanelField label="Profile">
                  {(control) => (
                    <Select value={profileId} onValueChange={setProfileId} disabled={Boolean(run)}>
                      <SelectTrigger {...control} size="sm" className="w-full text-xs">
                        <SelectValue placeholder="Pick a profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            {p.name}
                            {p.is_default ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </PanelField>
              )}
              {!letter && profiles.length === 0 && (
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  No freelancer profile yet, so the draft will be thinner.{" "}
                  <a
                    href={`${portalUrl}/freelancing/profile`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary font-medium hover:underline"
                  >
                    Add one
                  </a>
                </p>
              )}

              <Textarea
                ref={box}
                rows={2}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void write();
                }}
                disabled={Boolean(run)}
                aria-label={letter ? "What to change" : "What to lead with"}
                placeholder={
                  letter
                    ? "What to change: shorter, lead with the multiplayer build…"
                    : "Optional: what to lead with. A link here is read first."
                }
                className="max-h-40 min-h-14 text-xs md:text-xs"
              />

              {run ? (
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Progress label={run.label} percent={run.percent} />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={() => void stop()}
                    disabled={!run.generationId}
                    aria-label="Stop writing"
                    title="Stop writing"
                  >
                    <Square />
                  </Button>
                </div>
              ) : (
                <Button variant="brand" size="sm" className="w-full" disabled={!ready} onClick={() => void write()}>
                  {letter ? <WandSparkles /> : <Sparkles />}
                  {letter ? "Revise" : "Write proposal"}
                </Button>
              )}
            </CardContent>
          </Card>

          {error && <ErrorNote>{error}</ErrorNote>}
        </>
      )}
    </Section>
  );
}

/** One piece of the proposal as it is pasted into Upwork, with its copy button. */
function Writing({
  title,
  text,
  copyLabel,
  note,
  glow,
}: {
  title: string;
  text: string;
  copyLabel: string;
  note?: string;
  glow?: boolean;
}) {
  return (
    <Card className={cn("py-0 transition-shadow duration-700", glow && "ring-primary/40 ring-2")}>
      <CardContent className="space-y-1.5 p-3">
        <div className="flex items-start gap-2">
          <p className="text-muted-foreground min-w-0 flex-1 text-[11px] leading-snug font-medium">{title}</p>
          <CopyButton text={text} label={copyLabel} />
        </div>
        <p className="text-xs leading-relaxed break-words whitespace-pre-wrap">{text}</p>
        {note && <p className="text-subtle border-t pt-1.5 text-[10px] tabular-nums">{note}</p>}
      </CardContent>
    </Card>
  );
}
