import { Link2, Sparkles } from "lucide-react";
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
import { BASE_RESUME_KEY, STRATEGY_KEY } from "@/lib/constants";
import { focusTab, looksLikePosting } from "@/lib/page";
import { Section } from "../chrome-shell";
import { ErrorNote, PanelField } from "../components";
import { CurrentJob, type ResumeOption } from "./apply/CurrentJob";
import { JobTabList } from "./apply/JobTabList";
import { useJobBoard, type JobRow, type Strategy } from "./apply/use-job-board";

interface ResumeSummary {
  id: string;
  display_name: string;
  company_name?: string | null;
}

export function ApplyTab({ portalUrl }: { portalUrl: string }) {
  const board = useJobBoard(portalUrl);
  const [bases, setBases] = useState<ResumeOption[]>([]);
  const [tailored, setTailored] = useState<ResumeOption[]>([]);
  const [baseId, setBaseId] = useState("");
  const [strategy, setStrategy] = useState<Strategy>("existing");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Until the user picks tabs, the selection follows the postings that are open.
  const picked = useRef(false);

  useEffect(() => {
    void (async () => {
      const stored = (await chrome.storage.local.get([BASE_RESUME_KEY, STRATEGY_KEY])) as Record<
        string,
        string | undefined
      >;
      if (stored[STRATEGY_KEY] === "full") setStrategy("full");
      try {
        const list = await api<{ items: ResumeSummary[] }>("/api/v1/resumes");
        setBases(list.items.map((r) => ({ kind: "base", id: r.id, display_name: r.display_name })));
        const chosen = stored[BASE_RESUME_KEY];
        setBaseId(
          chosen && list.items.some((r) => r.id === chosen) ? chosen : (list.items[0]?.id ?? ""),
        );
      } catch (e) {
        setError((e as Error).message);
      }
      const recent = await api<{ items: ResumeSummary[] }>(
        "/api/v1/tailored-resumes?limit=100",
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
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  function chooseResume(id: string) {
    setBaseId(id);
    void chrome.storage.local.set({ [BASE_RESUME_KEY]: id });
  }

  function chooseStrategy(value: Strategy) {
    setStrategy(value);
    void chrome.storage.local.set({ [STRATEGY_KEY]: value });
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

  function tailor(targets: JobRow[]) {
    setError(null);
    // All at once: the backend runs several generations side by side.
    for (const row of targets) void board.tailor(row.tab, baseId, strategy);
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
        <CardContent className="px-3">
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

            <PanelField label="How to tailor">
              {(control) => (
                <Select value={strategy} onValueChange={(v) => chooseStrategy(v as Strategy)}>
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="existing">Upgrade existing resume</SelectItem>
                    <SelectItem value="full">Full upgrade from the job</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </PanelField>
          </FieldGroup>
        </CardContent>
      </Card>

      <Section title="This tab">
        <CurrentJob
          row={board.activeRow}
          resumes={[...tailored, ...bases]}
          baseResumeId={baseId}
          strategy={strategy}
          portalUrl={portalUrl}
          onTailor={(row) => tailor([row])}
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
          canTailor={Boolean(baseId)}
          onSelect={select}
          onTailor={(row) => tailor([row])}
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
                disabled={!baseId || !ready.length}
                onClick={() => tailor(ready)}
              >
                <Sparkles />
                Tailor {ready.length > 0 ? ready.length : ""} {ready.length === 1 ? "tab" : "tabs"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={!baseId || !ready.length}
                onClick={() => void useBaseResume(ready)}
              >
                <Link2 />
                Use base resume
              </Button>
            </div>
            <p className="text-subtle text-center text-[10px] leading-snug">
              Selected tabs run side by side, and each .docx downloads as it finishes. Runs keep
              going if you close the panel.
            </p>
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
      </Section>
    </>
  );
}
