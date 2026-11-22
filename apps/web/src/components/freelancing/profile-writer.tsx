"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, CornerDownLeft, MessageCircleQuestion, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Panel, PanelHead } from "@/components/panel";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useGeneration } from "@/hooks/use-generation";
import { request } from "@/lib/api";
import type { PortfolioItem, SpecializedProfile } from "@/lib/freelancing";
import {
  isSaved,
  versionLabel,
  versionsKey,
  versionsPath,
  type ProfileVersion,
  type ProfileVersions,
} from "@/lib/profile-writer";
import { cn } from "@/lib/utils";

/** The profile form as it is when an instruction is sent: what the writer works from. */
export interface ProfileMaterial {
  title: string | null;
  overview: string | null;
  hourly_rate: number | null;
  skills: string[];
  portfolio: PortfolioItem[];
  specialized_profiles: SpecializedProfile[];
  raw_profile_markdown: string | null;
}

const FIRST_PROMPT =
  "Tell it about you: stack, years of experience, country, target hourly rate, certifications (or \"none\"), " +
  "domains, 3–5 specialties, and each role (company, title, dates, what you built, the hardest problem, the outcome).";
const REFINE_PROMPT = "What to change, e.g. make the summary more technical, or: I also hold AWS SAA (2025)";

/**
 * Writes the profile from an instruction, and revises it from the next one.
 *
 * Each instruction becomes a draft numbered toward the next save (1.1, 1.2,
 * ...); Save on the form records the whole version (1). A finished draft is
 * applied to the form at once, so the form always shows the version it says.
 */
export function ProfileWriter({
  profileId,
  active,
  material,
  onApply,
  onSettle,
}: {
  profileId: string | null;
  /** The version the form holds now; a new instruction revises it. */
  active: ProfileVersion | null;
  material: () => ProfileMaterial;
  /** Put a version into the form. */
  onApply: (version: ProfileVersion) => void;
  /** Mark a version as the form's without touching the form: it already holds it. */
  onSettle: (version: ProfileVersion) => void;
}) {
  const { data, refetch } = useQuery({
    queryKey: versionsKey(profileId),
    queryFn: () => request<ProfileVersions>(versionsPath(profileId)),
  });
  const generation = useGeneration();
  const { state } = generation;
  const [instruction, setInstruction] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const [arrived, setArrived] = useState<string | null>(null);

  const items = data?.items ?? [];
  const latestSaved = items.findLast(isSaved) ?? null;

  // The saved profile is its latest saved version: on load, and after each save.
  const settled = useRef<string | null>(null);
  useEffect(() => {
    if (!latestSaved || settled.current === latestSaved.id) return;
    settled.current = latestSaved.id;
    onSettle(latestSaved);
  }, [latestSaved, onSettle]);

  // A draft still being written when the page opened: follow it.
  const followed = useRef(false);
  useEffect(() => {
    const running = data?.running_generation_id;
    if (!running || followed.current || state.running) return;
    followed.current = true;
    generation.attach(running);
  }, [data?.running_generation_id, generation, state.running]);

  // A finished draft goes straight into the form.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const id = state.resultId;
    if (state.running || !id || handled.current === id) return;
    handled.current = id;
    void refetch().then(({ data: fresh }) => {
      const version = fresh?.items.find((v) => v.id === id);
      if (!version) return;
      onApply(version);
      setArrived(version.id);
      setInstruction("");
      toast.success(`Draft ${versionLabel(version)} is in the form`, {
        description: version.document.questions?.length
          ? "It has questions for you. Answer them in the next instruction."
          : "Refine it with another instruction, or save it.",
      });
    });
  }, [state.running, state.resultId, refetch, onApply]);

  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(() => setArrived(null), 1600);
    return () => clearTimeout(timer);
  }, [arrived]);

  const ready = instruction.trim().length > 0 && !state.running;
  function send() {
    if (!ready) return;
    void generation.start("/api/v1/freelancing/profile-versions", {
      profile_id: profileId,
      based_on_id: active?.id ?? null,
      instruction: instruction.trim(),
      material: material(),
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

  const questions = active?.document.questions ?? [];
  const note = active && !isSaved(active) ? active.document.change_note : null;

  return (
    <Panel aria-busy={state.running}>
      <PanelHead
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="text-brand size-3.5" />
            Profile writer
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
                title={v.instruction ?? `Saved ${new Date(v.created_at).toLocaleString()}`}
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
          rows={active ? 2 : 4}
          className="min-h-0 resize-y"
          value={instruction}
          disabled={state.running}
          placeholder={active ? REFINE_PROMPT : FIRST_PROMPT}
          aria-label={active ? "How to change the profile" : "What the profile is written from"}
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
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground hidden items-center gap-1 text-[11px] sm:flex">
              <kbd className="bg-muted rounded px-1 font-sans">⌘</kbd>
              <CornerDownLeft className="size-3" />
            </span>
            <Button type="button" disabled={!ready} onClick={send}>
              {state.running ? <Spinner /> : <Sparkles />}
              {active ? `Revise ${versionLabel(active)}` : "Write profile"}
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
