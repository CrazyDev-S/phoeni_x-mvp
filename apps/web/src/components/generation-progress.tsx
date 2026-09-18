"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { ErrorAlert } from "@/components/error-alert";
import { FindingsList } from "@/components/findings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type { GenerationState } from "@/hooks/use-generation";
import { cn } from "@/lib/utils";

// Past this, the run is long enough that a static percentage reads as a hang.
const LONG_RUN_SECONDS = 60;

/**
 * Live progress for a streamed generation.
 *
 * The trail is built from the phases the backend actually announced rather
 * than a scripted list, so it never claims a step the run did not reach.
 *
 * A full generation spends minutes inside a single phase with the percentage
 * unchanged, so the elapsed time and the latest line of reasoning are shown
 * inline - without them a healthy run looks exactly like a stuck one.
 */
export function GenerationProgress({
  state,
  onOpen,
}: {
  state: GenerationState;
  onOpen?: (id: string) => void;
}) {
  const steps = state.steps;
  const currentIndex = steps.length - 1;
  const elapsed = useElapsedSeconds(state.running ? state.startedAt : null);
  const latestThought = state.running
    ? state.thinking.replace(/\s+/g, " ").trim().slice(-180)
    : "";

  return (
    <Card className="py-0">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2.5">
          {state.running && <Spinner className="text-primary" />}
          <span className="text-sm font-medium">{state.label || "Working…"}</span>
          <span className="text-muted-foreground ml-auto text-sm tabular-nums">
            {state.running && state.startedAt ? `${formatElapsed(elapsed)} · ` : ""}
            {state.percent}%
          </span>
        </div>

        <Progress value={state.percent} aria-label="Generation progress" />

        {state.running && elapsed >= LONG_RUN_SECONDS && (
          <p className="text-muted-foreground text-xs">
            A full run takes several minutes. It keeps going if you leave this page, and
            the result is saved when it finishes.
          </p>
        )}

        {steps.length > 0 && (
          <ol className="space-y-2">
            {steps.map((step, index) => {
              const done = index < currentIndex || !state.running;
              return (
                <li
                  key={`${step.phase}-${index}`}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
                      done
                        ? "bg-success/10 text-success"
                        : "bg-accent text-accent-foreground",
                    )}
                  >
                    {done ? (
                      <Check className="size-3" />
                    ) : (
                      <span className="bg-current size-1.5 animate-pulse rounded-full" />
                    )}
                  </span>
                  <span className={done ? "text-muted-foreground" : "font-medium"}>
                    {step.label || step.phase}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {latestThought && (
          <p className="text-muted-foreground truncate font-mono text-xs" title={latestThought}>
            …{latestThought}
          </p>
        )}

        {state.thinking && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="text-muted-foreground">
                Reasoning
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="bg-muted/50 mt-2 h-40 rounded-lg p-3">
                <p className="text-muted-foreground pr-3 font-mono text-xs whitespace-pre-wrap">
                  {state.thinking}
                </p>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}

        {state.error && <ErrorAlert>{state.error}</ErrorAlert>}

        {state.findings.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <FindingsList findings={state.findings} />
          </div>
        )}

        {state.resultId && onOpen && (
          <Button onClick={() => onOpen(state.resultId!)}>Open the result</Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Seconds since `since`, ticking once a second; 0 when there is no start. */
function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
