import { Download, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, downloadDocx, waitForGeneration } from "@/lib/api";
import { DRAFT_KEY } from "@/lib/constants";
import { Section } from "../chrome-shell";
import { ErrorNote, PanelField, Progress } from "../components";

/**
 * Generate a new resume without leaving the browser.
 *
 * Draft state is persisted on every change: the panel document is destroyed
 * whenever the panel closes, so anything held only in React state is lost.
 */
interface Draft {
  title?: string;
  skills?: string;
  notes?: string;
  jd?: string;
  useJd?: boolean;
}

export function GenerateTab() {
  const [title, setTitle] = useState("");
  const [skills, setSkills] = useState("");
  const [notes, setNotes] = useState("");
  const [jd, setJd] = useState("");
  const [useJd, setUseJd] = useState(false);
  const [phase, setPhase] = useState<{ label: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  useEffect(() => {
    void chrome.storage.local.get(DRAFT_KEY).then((s) => {
      const d = (s as Record<string, Draft | undefined>)[DRAFT_KEY];
      if (!d) return;
      setTitle(d.title ?? "");
      setSkills(d.skills ?? "");
      setNotes(d.notes ?? "");
      setJd(d.jd ?? "");
      setUseJd(Boolean(d.useJd));
    });
  }, []);

  useEffect(() => {
    const id = setTimeout(
      () =>
        void chrome.storage.local.set({ [DRAFT_KEY]: { title, skills, notes, jd, useJd } }),
      400,
    );
    return () => clearTimeout(id);
  }, [title, skills, notes, jd, useJd]);

  async function generate() {
    setError(null);
    setResultId(null);
    setPhase({ label: "Starting", percent: 2 });
    try {
      const path = useJd
        ? "/api/v1/resumes/generate/job"
        : "/api/v1/resumes/generate/story";
      const accepted = await api<{ id: string }>(path, {
        method: "POST",
        body: JSON.stringify({
          target_title: title,
          extra_instructions: notes || undefined,
          ...(useJd
            ? { job_description: jd }
            : { skill_count: skills ? Number(skills) : undefined }),
        }),
      });
      const done = await waitForGeneration(accepted.id, (label, percent) =>
        setPhase({ label, percent }),
      );
      setResultId((done.result_id as string) ?? null);
      setPhase({ label: "Done", percent: 100 });
      await chrome.storage.local.remove(DRAFT_KEY);
    } catch (e) {
      setError((e as Error).message);
      setPhase(null);
    }
  }

  const running = Boolean(phase && phase.percent < 100);

  return (
    <div className="flex flex-col gap-3">
      <Section title="New resume">
        <Card className="py-3">
          <CardContent className="px-3">
            <FieldGroup className="gap-3">
              <PanelField label="Target title">
                {(control) => (
                  <Input
                    {...control}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Senior Software Engineer – AI Fullstack"
                  />
                )}
              </PanelField>

              <Field orientation="horizontal">
                <Checkbox
                  id="use-jd"
                  checked={useJd}
                  onCheckedChange={(checked) => setUseJd(checked === true)}
                />
                <FieldLabel htmlFor="use-jd" className="text-xs font-normal">
                  Base it on a job description
                </FieldLabel>
              </Field>

              {useJd ? (
                <PanelField label="Job description">
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={7}
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                    />
                  )}
                </PanelField>
              ) : (
                <PanelField label="How many technologies?">
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      min={4}
                      max={40}
                      value={skills}
                      onChange={(e) => setSkills(e.target.value)}
                    />
                  )}
                </PanelField>
              )}

              <PanelField label="Anything else?">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                )}
              </PanelField>

              <Button
                variant="brand"
                className="h-10 w-full"
                disabled={!title || running}
                onClick={generate}
              >
                {running ? <Spinner /> : <Sparkles />}
                {running ? phase?.label || "Working…" : "Generate"}
              </Button>

              {phase && <Progress label={phase.label} percent={phase.percent} />}
              {error && <ErrorNote>{error}</ErrorNote>}

              {resultId && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    downloadDocx({ resume_id: resultId, kind: "base" }, `${title}.docx`)
                  }
                >
                  <Download />
                  Download .docx
                </Button>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      </Section>

      <p className="text-subtle px-1 text-[10px] leading-relaxed">
        Your draft is saved as you type — the panel is destroyed when it closes, so nothing
        here is held only in memory.
      </p>
    </div>
  );
}
