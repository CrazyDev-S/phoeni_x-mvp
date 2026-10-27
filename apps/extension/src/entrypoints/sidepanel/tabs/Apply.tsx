import { FilePen, Link2, Sparkles, Square, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { api } from "@/lib/api";
import { BASE_RESUME_KEY, MODE_KEY } from "@/lib/constants";
import { focusTab, looksLikePosting } from "@/lib/page";
import type { ResumeProfile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Section } from "../chrome-shell";
import { ErrorNote, PanelField } from "../components";
import { CurrentJob, type ResumeOption } from "./apply/CurrentJob";
import { JobTabList } from "./apply/JobTabList";
import { useJobBoard, type JobRow, type Mode } from "./apply/use-job-board";

interface ResumeSummary {
  id: string;
  display_name: string;
  company_name?: string | null;
}

const MODES: { value: Mode; label: string; Icon: LucideIcon; hint: string }[] = [
  {
    value: "generate",
    label: "New generate",
    Icon: Sparkles,
    hint: "A new resume from each posting and your resume profile.",
  },
  {
    value: "tailor",
    label: "Tailor",
    Icon: FilePen,
    hint: "Your base resume, reframed for each posting.",
  },
];

export function ApplyTab({
  portalUrl,
  onOpenSettings,
}: {
  portalUrl: string;
  onOpenSettings: () => void;
}) {
  const board = useJobBoard(portalUrl);
  const [bases, setBases] = useState<ResumeOption[]>([]);
  const [tailored, setTailored] = useState<ResumeOption[]>([]);
  const [baseId, setBaseId] = useState("");
  const [mode, setMode] = useState<Mode>("generate");
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Until the user picks tabs, the selection follows the postings that are open.
  const picked = useRef(false);

  useEffect(() => {
    void (async () => {
      const stored = (await chrome.storage.local.get([BASE_RESUME_KEY, MODE_KEY])) as Record<
        string,
        string | undefined
      >;
      if (stored[MODE_KEY] === "tailor") setMode("tailor");
      void api<ResumeProfile>("/api/v1/settings/resume-profile")
        .then(setProfile)
        .catch(() => setProfile(null));
      try {
        const list = await api<{ items: ResumeSummary[] }>("/api/v1/remote/resumes");
        setBases(list.items.map((r) => ({ kind: "base", id: r.id, display_name: r.display_name })));
        const chosen = stored[BASE_RESUME_KEY];
        setBaseId(
          chosen && list.items.some((r) => r.id === chosen) ? chosen : (list.items[0]?.id ?? ""),
        );
      } catch (e) {
        setError((e as Error).message);
      }
      const recent = await api<{ items: ResumeSummary[] }>(
        "/api/v1/remote/tailored-resumes?limit=100",
      ).catch(() => null);
      if (recent) {
        setTailored(
          recent.items.map((r) => ({
            kind: "tailored",
            id: r.id,
            display_name: r.display_name,
            company_name: r.company_name,
          })),
        );
      }
    })();
  }, []);

  const { rows } = board;
  useEffect(() => {
    if (picked.current) return;
    setSelected(
      new Set(
        rows
          .filter((r) => r.link && !r.link.resume && !r.run?.running && looksLikePosting(r.tab.url))
          .map((r) => r.tab.tabId),
      ),
    );
  }, [rows]);

  const chosen = rows.filter((r) => selected.has(r.tab.tabId));
  const ready = chosen.filter((r) => !r.run?.running);
  const stoppable = rows.filter((r) => r.run?.running && !r.run.stopping);
  // Generating needs no base resume. Tailoring a tab with a resume upgrades
  // that one, so only the rest need a base.
  const canRunReady =
    ready.length > 0 &&
    (mode === "generate" || Boolean(baseId) || ready.every((r) => r.link?.resume));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const verb = mode === "generate" ? "Generate" : "Tailor";

  function chooseResume(id: string) {
    setBaseId(id);
    void chrome.storage.local.set({ [BASE_RESUME_KEY]: id });
  }

  function chooseMode(value: Mode) {
    setMode(value);
    void chrome.storage.local.set({ [MODE_KEY]: value });
  }

  function select(tabId: number, on: boolean) {
    picked.current = true;
    setSelected((all) => {
      const next = new Set(all);
      if (on) next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }

  function selectAll(on: boolean) {
    picked.current = true;
    setSelected(on ? new Set(rows.map((r) => r.tab.tabId)) : new Set());
  }

  function run(targets: JobRow[]) {
    setError(null);
    // All at once: the backend runs several generations side by side.
    for (const row of targets) {
      void (mode === "generate" ? board.generate(row.tab) : board.tailor(row.tab, baseId));
    }
  }

  function stop(row: JobRow) {
    void board.stop(row.link?.job_key ?? row.tab.url);
  }

  async function useBaseResume(targets: JobRow[]) {
    setError(null);
    const outcomes = await Promise.allSettled(
      targets.map((row) => board.linkResume(row.tab, { kind: "base", id: baseId })),
    );
    const failed = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    if (failed) setError((failed.reason as Error)?.message ?? "Some tabs could not be linked.");
  }

  return (
    <>
      <Card className="py-3">
        <CardContent className="space-y-3 px-3">
          <div className="space-y-1.5">
            <div
              role="group"
              aria-label="How to make each resume"
              className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1"
            >
              {MODES.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => chooseMode(value)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors outline-none focus-visible:ring-3",
                    mode === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-3.5", mode === value && "text-primary")} />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground px-0.5 text-[11px] leading-snug">
              {MODES.find((m) => m.value === mode)?.hint}
            </p>
          </div>

          {mode === "generate" ? (
            <ProfileLine profile={profile} onOpenSettings={onOpenSettings} />
          ) : (
            <FieldGroup className="gap-3">
              <PanelField label="Base resume">
                {(control) => (
                  <Select value={baseId} onValueChange={chooseResume}>
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue placeholder="Choose a resume…" />
                    </SelectTrigger>
                    <SelectContent>
                      {bases.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </PanelField>
            </FieldGroup>
          )}
        </CardContent>
      </Card>

      <Section title="This tab">
        <CurrentJob
          row={board.activeRow}
          resumes={[...tailored, ...bases]}
          baseResumeId={baseId}
          mode={mode}
          portalUrl={portalUrl}
          onRun={(row) => run([row])}
          onStop={stop}
          onLink={(row, resume) => board.linkResume(row.tab, resume)}
          onDownload={(row) => board.download(row)}
        />
      </Section>

      <Section
        title={`Open tabs · ${rows.length}`}
        action={
          rows.length > 0 && (
            <Button size="xs" variant="ghost" onClick={() => selectAll(!allChosen)}>
              {allChosen ? "Clear" : "Select all"}
            </Button>
          )
        }
      >
        <JobTabList
          rows={rows}
          selected={selected}
          mode={mode}
          canTailor={Boolean(baseId)}
          onSelect={select}
          onRun={(row) => run([row])}
          onStop={stop}
          onDownload={(row) =>
            void board.download(row).catch((e: Error) => setError(e.message))
          }
          onFocus={(row) => void focusTab(row.tab.tabId)}
        />

        {rows.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                className="flex-1"
                disabled={!canRunReady}
                onClick={() => run(ready)}
              >
                {mode === "generate" ? <Sparkles /> : <FilePen />}
                {verb} {ready.length > 0 ? ready.length : ""} {ready.length === 1 ? "tab" : "tabs"}
              </Button>
              {stoppable.length > 1 && (
                <Button variant="outline" onClick={() => stoppable.forEach(stop)}>
                  <Square />
                  Stop all
                </Button>
              )}
              {mode === "tailor" && (
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!baseId || !ready.length}
                  onClick={() => void useBaseResume(ready)}
                >
                  <Link2 />
                  Use base resume
                </Button>
              )}
            </div>
            <p className="text-subtle text-center text-[10px] leading-snug">
              {mode === "generate"
                ? "Selected tabs generate side by side, and each .docx downloads as it finishes. Each new resume becomes its tab's resume. Runs keep going if you close the panel."
                : "Selected tabs run side by side, and each .docx downloads as it finishes. A tab that already has a resume gets that one upgraded in place. Runs keep going if you close the panel."}
            </p>
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
      </Section>
    </>
  );
}

/** Whose resume a generation builds, or that nobody's is set up yet. */
function ProfileLine({
  profile,
  onOpenSettings,
}: {
  profile: ResumeProfile | null;
  onOpenSettings: () => void;
}) {
  if (!profile) return null;
  const set = profile.configured;
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-2.5 py-2",
        set ? "bg-muted/40" : "border-warning/40 bg-warning/5",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          set ? "bg-accent text-accent-foreground" : "bg-warning/15 text-warning",
        )}
      >
        <UserRound className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {set ? profile.full_name || "Your resume profile" : "No resume profile yet"}
        </p>
        <p className="text-muted-foreground truncate text-[10px]">
          {!set
            ? "Names and contacts get made up"
            : profile.mode === "grounded"
              ? "Keeps your work history"
              : "Career built from each job"}
        </p>
      </div>
      <Button size="xs" variant={set ? "ghost" : "outline"} onClick={onOpenSettings}>
        {set ? "Edit" : "Set up"}
      </Button>
    </div>
  );
}
