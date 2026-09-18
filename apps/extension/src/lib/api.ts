/**
 * All backend I/O lives in the side panel document.
 *
 * It must NOT move into the service worker: MV3 workers are evicted after ~30s
 * idle and a tailoring run takes 60-180s. The panel is a normal long-lived
 * page context, and its fetches are exempt from CORS because the extension
 * holds host permissions.
 */
import {
  API_BASE_KEY,
  DEFAULT_API_BASE,
  DEFAULT_PORTAL_URL,
  PORTAL_URL_KEY,
  TOKEN_KEY,
} from "./constants";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface Settings {
  apiBase: string;
  token: string;
  /** Where the web portal lives, for the "open in portal" links. */
  portalUrl: string;
}

export async function getSettings(): Promise<Settings> {
  const local = (await chrome.storage.local.get([
    API_BASE_KEY,
    TOKEN_KEY,
    PORTAL_URL_KEY,
  ])) as Record<string, string | undefined>;
  return {
    apiBase: local[API_BASE_KEY] ?? DEFAULT_API_BASE,
    token: local[TOKEN_KEY] ?? "",
    portalUrl: local[PORTAL_URL_KEY] ?? DEFAULT_PORTAL_URL,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (settings.apiBase !== undefined)
    payload[API_BASE_KEY] = settings.apiBase.replace(/\/$/, "");
  if (settings.token !== undefined) payload[TOKEN_KEY] = settings.token;
  if (settings.portalUrl !== undefined) {
    payload[PORTAL_URL_KEY] = settings.portalUrl.replace(/\/$/, "");
  }
  await chrome.storage.local.set(payload);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiBase, token } = await getSettings();
  if (!token) throw new ApiError(401, "NO_TOKEN", "Add your access token in Settings.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json())?.detail;
    } catch {
      detail = res.statusText;
    }
    const message =
      typeof detail === "string"
        ? detail
        : ((detail as { message?: string })?.message ?? `Request failed (${res.status})`);
    const code = (detail as { code?: string })?.code ?? String(res.status);
    throw new ApiError(res.status, code, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** A stored resume rendered as .docx, in memory. */
export async function fetchDocx(body: Record<string, unknown>): Promise<Blob> {
  const { apiBase, token } = await getSettings();
  const res = await fetch(`${apiBase}/api/v1/export/docx`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, "EXPORT", "Could not build the document");
  return res.blob();
}

/**
 * Download through chrome.downloads rather than an anchor.
 *
 * It gives a deterministic filename, a real completion signal, and transfers
 * ownership to the browser — closing the narrow panel mid-download does not
 * cancel it. (URL.createObjectURL is also unavailable in MV3 service workers,
 * which is another reason the fetch lives here.)
 */
export async function downloadDocx(
  body: Record<string, unknown>,
  filename: string,
): Promise<void> {
  const blob = await fetchDocx(body);
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({
      url,
      filename: sanitize(filename),
      saveAs: false,
      conflictAction: "uniquify",
    });
    await new Promise<void>((resolve) => {
      const listener = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === "complete" || delta.state.current === "interrupted") {
          chrome.downloads.onChanged.removeListener(listener);
          resolve();
        }
      };
      chrome.downloads.onChanged.addListener(listener);
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }
}

/** A .docx filename from its parts, e.g. "Acme - Senior Engineer.docx". */
export function docxName(...parts: (string | null | undefined)[]): string {
  return sanitize(`${parts.filter(Boolean).join(" - ") || "Resume"}.docx`);
}

/** Base64 for a blob: executeScript arguments must be JSON, not bytes. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked: spreading a whole file into fromCharCode overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").slice(0, 120) || "Resume.docx";
}

export interface GenerationEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

/** Poll a generation to completion. The panel can hold this open; a worker cannot. */
export async function waitForGeneration(
  id: string,
  onPhase: (label: string, percent: number) => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let seq = -1;
  for (;;) {
    if (signal?.aborted) throw new ApiError(499, "CANCELLED", "Cancelled");
    const events = await api<GenerationEvent[]>(
      `/api/v1/generations/${id}/events-json?after=${seq}`,
    ).catch(() => null);

    if (events) {
      for (const event of events) {
        seq = event.seq;
        if (event.type === "phase") {
          onPhase(String(event.payload.label ?? ""), Number(event.payload.percent ?? 0));
        }
        if (event.type === "complete") return event.payload;
        if (event.type === "error") {
          throw new ApiError(500, String(event.payload.code), String(event.payload.detail));
        }
      }
    } else {
      // Fall back to polling the row if the events endpoint is unavailable.
      const gen = await api<{
        status: string;
        phase: string | null;
        progress_percent: number;
        error_detail: string | null;
        result_id: string | null;
      }>(`/api/v1/generations/${id}`);
      onPhase(gen.phase ?? "Working", gen.progress_percent);
      if (gen.status === "failed")
        throw new ApiError(500, "FAILED", gen.error_detail ?? "Failed");
      if (gen.status === "succeeded" || gen.status === "needs_review") {
        return { result_id: gen.result_id };
      }
    }
    await new Promise((r) => setTimeout(r, 900));
  }
}
