/**
 * The single API client, shared by the Next.js portal and the Chrome side panel.
 *
 * Types in `schema.d.ts` are GENERATED from the backend's own `/openapi.json`
 * (`npm run types`). A CI check that the committed file is current means a
 * backend change that breaks a client fails the build, rather than failing in
 * somebody's browser.
 */
import createClient from "openapi-fetch";
import type { paths } from "./schema";

export type { paths };

export interface TokenStore {
  get(): Promise<string | null> | string | null;
  set?(token: string | null): Promise<void> | void;
}

export interface ApiOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Called on a 401 so each surface can react in its own way. */
  onUnauthorized?: () => void;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApi({ baseUrl, tokens, onUnauthorized }: ApiOptions) {
  const client = createClient<paths>({ baseUrl });

  client.use({
    async onRequest({ request }) {
      const token = await tokens.get();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401) onUnauthorized?.();
      return response;
    },
  });

  return client;
}

/** Normalize FastAPI's several error shapes into one thing the UI can render. */
export function toApiError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === "string") return new ApiError(status, "ERROR", detail, body);
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    return new ApiError(
      status,
      String(d.code ?? "ERROR"),
      String(d.message ?? d.detail ?? "Request failed"),
      detail,
    );
  }
  // 422 from Pydantic: a list of {loc, msg, type}.
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string; loc?: unknown[] } | undefined;
    return new ApiError(
      status,
      "VALIDATION",
      first?.msg ? `${(first.loc ?? []).slice(1).join(".")}: ${first.msg}` : "Invalid input",
      detail,
    );
  }
  return new ApiError(status, "ERROR", `Request failed (${status})`, body);
}

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
