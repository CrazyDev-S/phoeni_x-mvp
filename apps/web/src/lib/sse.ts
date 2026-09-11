"use client";

import { API_URL, tokens } from "./api";

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

  (async () => {
    while (!stopped) {
      try {
        const headers = new Headers({ Accept: "text/event-stream" });
        const access = tokens.access();
        if (access) headers.set("Authorization", `Bearer ${access}`);
        if (lastId >= 0) headers.set("Last-Event-ID", String(lastId));

        const res = await fetch(
          `${API_URL}/api/v1/generations/${generationId}/events`,
          { headers, signal: controller.signal },
        );
        if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let split: number;
          while ((split = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
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
        // Reconnect and replay from lastId rather than losing the job.
        await new Promise((r) => setTimeout(r, 1500));
      }
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
  for (const line of raw.split("\n")) {
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
