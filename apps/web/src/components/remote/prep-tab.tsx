"use client";

import { ClipboardList } from "lucide-react";
import { useEffect, useRef } from "react";

import { GenerationProgress } from "@/components/remote/generation-progress";
import { PanelNote, PrepPanel, type Flags } from "@/components/remote/resume-editor";
import { Button } from "@/components/ui/button";
import { useGeneration } from "@/hooks/use-generation";

/**
 * The Prep tab: the interview-prep block, and the button that writes it.
 *
 * Analysing reads the SAVED resume and changes nothing but the prep, so it is
 * held back while there are unsaved edits rather than describing a version the
 * user is about to replace.
 */
export function PrepTab({
  path,
  flags,
  dirty,
  onDone,
}: {
  /** The endpoint that queues the analysis, e.g. /api/v1/remote/resumes/{id}/prep. */
  path: string;
  flags: Flags | null;
  dirty: boolean;
  onDone: () => void;
}) {
  const prep = useGeneration();
  const finished = prep.state.running ? null : prep.state.resultId;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (finished) done.current();
  }, [finished]);

  const running = prep.state.running;
  return (
    <div>
      {flags ? (
        <PrepPanel value={flags} empty="" />
      ) : (
        <PanelNote>No interview prep yet.</PanelNote>
      )}

      <div className="bg-muted/40 space-y-2 border-t px-3 py-2">
        {(running || prep.state.error) && (
          <GenerationProgress state={prep.state} onStop={prep.stop} />
        )}
        {!running && (
          <Button
            variant={flags ? "outline" : "brand"}
            className="w-full"
            disabled={dirty}
            title={
              dirty
                ? "Save or discard your edits first. Prep reads the saved version."
                : undefined
            }
            onClick={() => void prep.start(path, {})}
          >
            <ClipboardList />
            {flags ? "Re-analyze & rebuild prep" : "Analyze & build prep"}
          </Button>
        )}
      </div>
    </div>
  );
}
