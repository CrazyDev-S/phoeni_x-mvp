"use client";

import { API_URL, request, tokens } from "./api";

export interface GenerationEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Subscribe to a generation's event stream.
 *
 * `EventSource` cannot send an Authorization header, so this reads the stream
 * with `fetch` and parses SSE by hand. That also gives us `Last-Event-ID`
 * replay on reconnect, which matters because a generation runs 60-180s and the
 * user will switch tabs during it.
 */
const RECONNECT_DELAY_MS = 1200;
const MAX_RECONNECTS = 40;
// A frame ends at a blank line, and the spec allows CRLF, LF, or CR line
// endings. sse-starlette sends CRLF, so matching only "\n\n" never finds a
// frame: nothing is ever parsed and the UI sits at "Starting... 0%" forever.
const FRAME_END = /\r\n\r\n|\n\n|\r\r/;

export function streamGeneration(
  generationId: string,
  handlers: {
    onEvent: (event: GenerationEvent) => void;
    onError?: (error: unknown) => void;
    onClose?: () => void;
  },
): () => void {
  const controller = new AbortController();
  let lastId = -1;
  let stopped = false;
  let reconnects = 0;

  (async () => {
    while (!stopped) {
      if (reconnects > MAX_RECONNECTS) {
        // Give up on the stream and fall back to asking the API outright,
        // rather than reconnecting forever behind a spinner.
        await settleFromApi(generationId, handlers);
        return;
      }
      try {
        const headers = new Headers({ Accept: "text/event-stream" });
        const access = tokens.access();
        if (access) headers.set("Authorization", `Bearer ${access}`);
        if (lastId >= 0) headers.set("Last-Event-ID", String(lastId));

        const res = await fetch(`${API_URL}/api/v1/generations/${generationId}/events`, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let end: RegExpExecArray | null;
          while ((end = FRAME_END.exec(buffer)) !== null) {
            const raw = buffer.slice(0, end.index);
            buffer = buffer.slice(end.index + end[0].length);
            const event = parseFrame(raw);
            if (!event) continue;
            lastId = event.id;
            handlers.onEvent(event);
            if (event.type === "complete" || event.type === "error") {
              stopped = true;
              handlers.onClose?.();
              return;
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted || stopped) return;
        handlers.onError?.(error);
      }

      // Reached only when the stream ended without a terminal event. Always
      // wait before reconnecting: without this, a server that closes
      // immediately turns into a tight reconnect loop behind a spinner that
      // never resolves.
      if (stopped) return;
      reconnects += 1;
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    }
  })();

  return () => {
    stopped = true;
    controller.abort();
  };
}

function parseFrame(raw: string): GenerationEvent | null {
  let id = -1;
  let type = "message";
  const dataLines: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim());
    else if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { id, type, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}


/** Last resort: ask for the generation's state directly and settle the UI. */
async function settleFromApi(
  generationId: string,
  handlers: { onEvent: (event: GenerationEvent) => void; onClose?: () => void },
): Promise<void> {
  try {
    const generation = await request<{
      status: string;
      result_kind: string | null;
      result_id: string | null;
      error_code: string | null;
      error_detail: string | null;
    }>(`/api/v1/generations/${generationId}`);

    const finished = ["succeeded", "needs_review", "failed", "cancelled"].includes(
      generation.status,
    );
    if (finished) {
      handlers.onEvent({
        id: -1,
        type: generation.status === "failed" ? "error" : "complete",
        data: {
          replayed: true,
          status: generation.status,
          result_kind: generation.result_kind,
          result_id: generation.result_id,
          needs_review: generation.status === "needs_review",
          code: generation.error_code,
          detail: generation.error_detail,
        },
      });
    } else {
      handlers.onEvent({
        id: -1,
        type: "error",
        data: {
          code: "STREAM_LOST",
          detail:
            "Lost the progress stream. The job is still running - reopen this resume shortly to see the result.",
        },
      });
    }
  } catch {
    handlers.onEvent({
      id: -1,
      type: "error",
      data: { code: "STREAM_LOST", detail: "Lost contact with the server." },
    });
  } finally {
    handlers.onClose?.();
  }
}
