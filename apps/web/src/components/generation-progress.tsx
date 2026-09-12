"use client";

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

/**
 * Live progress for a streamed generation.
 *
 * The trail is built from the phases the backend actually announced rather
 * than a scripted list, so it never claims a step the run did not reach.
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

  return (
    <Card className="py-0">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2.5">
          {state.running && <Spinner className="text-primary" />}
          <span className="text-sm font-medium">{state.label || "Working…"}</span>
          <span className="text-muted-foreground ml-auto text-sm tabular-nums">
            {state.percent}%
          </span>
        </div>

        <Progress value={state.percent} aria-label="Generation progress" />

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
