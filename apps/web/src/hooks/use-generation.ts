"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { request } from "@/lib/api";
import { streamGeneration } from "@/lib/sse";
import type { Finding } from "@/components/remote/findings";

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
  /** Stop was pressed and the backend has not confirmed it yet. */
  stopping: boolean;
  /** The run was stopped before it finished; nothing was saved. */
  cancelled: boolean;
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
  stopping: false,
  cancelled: false,
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
  const idRef = useRef<string | null>(null);
  // Stop pressed before the backend had named the run.
  const stopEarly = useRef(false);

  useEffect(() => () => cancelRef.current?.(), []);

  const start = useCallback(async (path: string, body: unknown) => {
    cancelRef.current?.();
    idRef.current = null;
    stopEarly.current = false;
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

    idRef.current = accepted.id;
    setState((s) => ({ ...s, id: accepted.id }));
    if (stopEarly.current) void requestStop(accepted.id);
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
            case "cancelled":
              return { ...s, running: false, stopping: false, cancelled: true, label: "Stopped" };
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

  /** Follow a run that was started elsewhere - a dialog, another page. */
  const attach = useCallback((id: string) => {
    cancelRef.current?.();
    idRef.current = id;
    stopEarly.current = false;
    setState({ ...IDLE, id, running: true, label: "Working…", startedAt: Date.now() });
    cancelRef.current = streamGeneration(id, {
      onEvent: (event) => {
        setState((s) => {
          const d = event.data as Record<string, never>;
          switch (event.type) {
            case "phase": {
              const phase = String(d.phase ?? "");
              const label = String(d.label ?? "");
              const steps =
                s.steps.at(-1)?.phase === phase ? s.steps : [...s.steps, { phase, label }];
              return { ...s, phase, label, steps, percent: Number(d.percent ?? s.percent) };
            }
            case "complete":
              return {
                ...s,
                percent: 100,
                running: false,
                label: "Done",
                resultKind: (d.result_kind as string) ?? null,
                resultId: (d.result_id as string) ?? null,
                needsReview: Boolean(d.needs_review),
              };
            case "cancelled":
              return { ...s, running: false, stopping: false, cancelled: true, label: "Stopped" };
            case "error":
              return { ...s, running: false, error: `${d.code}: ${d.detail}` };
            default:
              return s;
          }
        });
      },
      onError: () => {},
      onClose: () => setState((s) => ({ ...s, running: false })),
    });
  }, []);

  /**
   * Stop the run. The backend drops it mid-call and saves nothing; the stream
   * then reports "cancelled", which is what ends the running state.
   */
  const stop = useCallback(async () => {
    setState((s) => (s.running ? { ...s, stopping: true, label: "Stopping…" } : s));
    if (idRef.current) await requestStop(idRef.current);
    else stopEarly.current = true;
  }, []);

  const reset = useCallback(() => {
    cancelRef.current?.();
    setState(IDLE);
  }, []);

  return { state, start, attach, stop, reset };
}

async function requestStop(id: string): Promise<void> {
  try {
    await request(`/api/v1/generations/${id}/cancel`, { method: "POST" });
    toast("Stopped. Nothing was saved.");
  } catch {
    // Refused because it had just finished: the stream reports the result.
  }
}

function describe(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (e?.code === "NO_PROVIDER_KEY") {
    return "No API key configured. Add one in Settings before generating.";
  }
  return e?.message ?? "Something went wrong";
}
