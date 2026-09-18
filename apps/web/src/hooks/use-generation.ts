"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { request } from "@/lib/api";
import { streamGeneration } from "@/lib/sse";
import type { Finding } from "@/components/findings";

export interface Step {
  phase: string;
  label: string;
}

export interface GenerationState {
  id: string | null;
  phase: string;
  label: string;
  /** Every phase the stream has announced, in order, for the progress trail. */
  steps: Step[];
  percent: number;
  thinking: string;
  findings: Finding[];
  report: Record<string, unknown> | null;
  resultKind: string | null;
  resultId: string | null;
  needsReview: boolean;
  error: string | null;
  running: boolean;
  /** When the run was started, for the elapsed timer. */
  startedAt: number | null;
}

const IDLE: GenerationState = {
  id: null,
  phase: "",
  label: "",
  steps: [],
  percent: 0,
  thinking: "",
  findings: [],
  report: null,
  resultKind: null,
  resultId: null,
  needsReview: false,
  error: null,
  running: false,
  startedAt: null,
};

/**
 * Start a generation and follow its event stream.
 *
 * A full run takes 60-180s, so the UI shows named phases rather than a
 * spinner. The `reused` flag on the accept response means the instant path
 * served a cached result and there is nothing to stream.
 */
export function useGeneration() {
  const [state, setState] = useState<GenerationState>(IDLE);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const start = useCallback(async (path: string, body: unknown) => {
    cancelRef.current?.();
    setState({ ...IDLE, running: true, label: "Starting…", startedAt: Date.now() });

    let accepted: {
      id: string;
      reused?: boolean;
      result_kind?: string | null;
      result_id?: string | null;
    };
    try {
      accepted = await request(path, { method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      setState({ ...IDLE, error: describe(error) });
      return null;
    }

    if (accepted.reused) {
      setState({
        ...IDLE,
        id: accepted.id,
        percent: 100,
        label: "Reused an identical recent run",
        resultKind: accepted.result_kind ?? null,
        resultId: accepted.result_id ?? null,
      });
      return accepted;
    }

    setState((s) => ({ ...s, id: accepted.id }));
    cancelRef.current = streamGeneration(accepted.id, {
      onEvent: (event) => {
        setState((s) => {
          const d = event.data as Record<string, never>;
          switch (event.type) {
            case "phase": {
              const phase = String(d.phase ?? "");
              const label = String(d.label ?? "");
              // The stream can repeat a phase; the trail records each one once.
              const steps =
                s.steps.at(-1)?.phase === phase ? s.steps : [...s.steps, { phase, label }];
              return { ...s, phase, label, steps, percent: Number(d.percent ?? s.percent) };
            }
            case "thinking":
              return { ...s, thinking: (s.thinking + String(d.text ?? "")).slice(-4000) };
            case "usage":
              return Array.isArray(d.findings) ? { ...s, findings: d.findings } : s;
            case "complete":
              return {
                ...s,
                percent: 100,
                running: false,
                label: "Done",
                findings: (d.findings as Finding[]) ?? s.findings,
                report: (d.report as Record<string, unknown>) ?? null,
                resultKind: (d.result_kind as string) ?? null,
                resultId: (d.result_id as string) ?? null,
                needsReview: Boolean(d.needs_review),
              };
            case "error":
              return { ...s, running: false, error: `${d.code}: ${d.detail}` };
            default:
              return s;
          }
        });
      },
      onError: () => {
        // The stream reconnects and replays; only surface a hard failure.
      },
      onClose: () => setState((s) => ({ ...s, running: false })),
    });
    return accepted;
  }, []);

  const reset = useCallback(() => {
    cancelRef.current?.();
    setState(IDLE);
  }, []);

  return { state, start, reset };
}

function describe(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (e?.code === "NO_PROVIDER_KEY") {
    return "No API key configured. Add one in Settings before generating.";
  }
  return e?.message ?? "Something went wrong";
}
