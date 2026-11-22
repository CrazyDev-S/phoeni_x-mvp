"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, CornerDownLeft, MessageCircleQuestion, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDelete } from "@/components/confirm-delete";
import { Panel, PanelHead } from "@/components/panel";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useGeneration } from "@/hooks/use-generation";
import { request } from "@/lib/api";
import type { Proposal, ProposalAnswer } from "@/lib/freelancing";
import {
  isSaved,
  proposalVersionsKey,
  proposalVersionsPath,
  versionLabel,
  type ProposalVersion,
  type ProposalVersions,
} from "@/lib/proposal-writer";
import { cn } from "@/lib/utils";

const FIRST_PROMPT =
  "Optional: what to lead with, or a link to the project that fits best, e.g. Lead with the Stripe Connect payouts I built — https://…";
const REFINE_PROMPT = "What to change, e.g. shorter, warmer hook, or: use my HIPAA intake app as the spike";

/**
 * Writes the proposal from an instruction, and revises it from the next one.
 *
 * Each instruction becomes a draft numbered toward the next save (1.1, 1.2,
 * ...); Save on the editor records the whole version (1). A finished draft
 * lands in the proposal itself, so the editor shows it at once.
 */
export function ProposalWriter({
  proposal,
  profileId,
  active,
  writing,
  onApply,
  onChanged,
}: {
  proposal: Proposal;
  /** The profile picked in the editor; the writer writes as it. */
  profileId: string | null;
  /** The version the editor holds now; a new instruction revises it. */
  active: ProposalVersion | null;
  /** The editor's letter and answers now, hand edits included. */
  writing: () => { cover_letter_markdown: string; answers: ProposalAnswer[] };
  /** Put a version into the editor. */
  onApply: (version: ProposalVersion) => void;
  /** The proposal changed on the server: a draft landed, or a version was deleted. */
  onChanged: (next?: Proposal) => void;
}) {
  const { data, refetch } = useQuery({
    queryKey: proposalVersionsKey(proposal.id),
    queryFn: () => request<ProposalVersions>(proposalVersionsPath(proposal.id)),
  });
  const generation = useGeneration();
  const { state } = generation;
  const [instruction, setInstruction] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const items = data?.items ?? [];

  // A draft still being written when the page opened (the first one, usually): follow it.
  const followed = useRef<string | null>(null);
  useEffect(() => {
    const running = data?.running_generation_id;
    if (!running || followed.current === running || state.running) return;
    followed.current = running;
    generation.attach(running);
  }, [data?.running_generation_id, generation, state.running]);

  // A finished draft is already in the proposal; the editor reloads it.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const id = state.resultId;
    if (state.running || !id || handled.current === id) return;
    handled.current = id;
    void refetch().then(({ data: fresh }) => {
      const version = fresh?.items.find((v) => v.id === id);
      onChanged();
      if (!version) return;
      setArrived(version.id);
      setInstruction("");
      toast.success(`Draft ${versionLabel(version)} is in the editor`, {
        description: version.document.questions?.length
          ? "It has a question for you. Answer it in the next instruction."
          : "Refine it with another instruction, or save it.",
      });
    });
  }, [state.running, state.resultId, refetch, onChanged]);

  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(() => setArrived(null), 1600);
    return () => clearTimeout(timer);
  }, [arrived]);

  const hasLetter = Boolean(proposal.cover_letter_markdown.trim()) || Boolean(active);
  const ready = !state.running && (instruction.trim().length > 0 || !hasLetter);
  function send() {
    if (!ready) return;
    const current = writing();
    void generation.start("/api/v1/freelancing/proposals/generate", {
      job_id: proposal.job_id,
      proposal_id: proposal.id,
      profile_id: profileId,
      based_on_id: active?.id ?? null,
      current: current.cover_letter_markdown.trim() ? current : null,
      instruction: instruction.trim() || null,
    });
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

  async function remove(version: ProposalVersion) {
    const next = await request<Proposal>(`${proposalVersionsPath(proposal.id)}/${version.id}`, { method: "DELETE" });
    await refetch();
    onChanged(next);
    toast.success(`Version ${versionLabel(version)} deleted`);
  }

  const questions = active?.document.questions ?? [];
  const note = active && !isSaved(active) ? active.document.change_note : null;

  return (
    <Panel aria-busy={state.running}>
      <PanelHead
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="text-brand size-3.5" />
            Proposal writer
          </span>
        }
      >
        {items.length > 0 && (
          <ChipRow className="justify-end" aria-label="Versions">
            {items.map((v) => (
              <Chip
                key={v.id}
                type="button"
                size="sm"
                active={active?.id === v.id}
                disabled={state.running}
                title={v.instruction ?? (isSaved(v) ? `Saved ${new Date(v.created_at).toLocaleString()}` : "First draft")}
                className={cn("tabular-nums", !isSaved(v) && "border-dashed", arrived === v.id && "fill-glow")}
                onClick={() => onApply(v)}
              >
                {isSaved(v) && <Check />}
                {versionLabel(v)}
              </Chip>
            ))}
          </ChipRow>
        )}
      </PanelHead>

      <div className="space-y-2 p-3">
        <Textarea
          ref={box}
          rows={2}
          className="min-h-0 resize-y"
          value={instruction}
          disabled={state.running}
          placeholder={hasLetter ? REFINE_PROMPT : FIRST_PROMPT}
          aria-label={hasLetter ? "How to change the proposal" : "What to lead with"}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          {note && <p className="text-muted-foreground min-w-0 flex-1 text-xs">{note}</p>}
          <div className="ml-auto flex items-center gap-1.5">
            {active && !state.running && (
              <ConfirmDelete
                label={`version ${versionLabel(active)}`}
                description={
                  proposal.version_id === active.id
                    ? "The editor goes back to the version before it. This cannot be undone."
                    : "This cannot be undone."
                }
                onDelete={() => remove(active)}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Delete version ${versionLabel(active)}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 />
                    {versionLabel(active)}
                  </Button>
                }
              />
            )}
            <span className="text-muted-foreground hidden items-center gap-1 text-[11px] sm:flex">
              <kbd className="bg-muted rounded px-1 font-sans">⌘</kbd>
              <CornerDownLeft className="size-3" />
            </span>
            <Button type="button" disabled={!ready} onClick={send}>
              {state.running ? <Spinner /> : <Sparkles />}
              {active ? `Revise ${versionLabel(active)}` : hasLetter ? "Revise letter" : "Write proposal"}
            </Button>
          </div>
        </div>

        {questions.length > 0 && !state.running && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Questions to answer">
            {questions.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  className="bg-warning/10 text-foreground hover:bg-warning/20 focus-visible:ring-ring/40 flex max-w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors outline-none focus-visible:ring-2 active:scale-[0.98]"
                  onClick={() => answer(q)}
                >
                  <MessageCircleQuestion className="text-warning mt-px size-3.5 shrink-0" />
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}

        {(state.running || state.error) && <GenerationProgress state={state} onStop={generation.stop} />}
      </div>
    </Panel>
  );
}
