"use client";

/**
 * Browser-side API access.
 *
 * The access token lives in memory plus sessionStorage; the refresh token in
 * localStorage. A 401 triggers exactly one refresh attempt, and concurrent
 * callers share it rather than each firing their own.
 */
import { createApi, toApiError, type TokenStore } from "@resume-assist/api-types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const ACCESS_KEY = "ra.access";
const REFRESH_KEY = "ra.refresh";

let memoryAccess: string | null = null;
let refreshing: Promise<string | null> | null = null;

export const tokens = {
  access(): string | null {
    if (memoryAccess) return memoryAccess;
    if (typeof window === "undefined") return null;
    memoryAccess = window.sessionStorage.getItem(ACCESS_KEY);
    return memoryAccess;
  },
  refresh(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  save(access: string, refresh: string) {
    memoryAccess = access;
    window.sessionStorage.setItem(ACCESS_KEY, access);
    window.localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    memoryAccess = null;
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

const store: TokenStore = { get: () => tokens.access() };

export const api = createApi({
  baseUrl: API_URL,
  tokens: store,
  onUnauthorized: () => {
    /* handled per-request in `request` below */
  },
});

async function tryRefresh(): Promise<string | null> {
  const refresh = tokens.refresh();
  if (!refresh) return null;
  // Share one in-flight refresh across concurrent 401s.
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        tokens.clear();
        return null;
      }
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      tokens.save(data.access_token, data.refresh_token);
      return data.access_token;
    } finally {
      // Let the next 401 start a fresh attempt.
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

/** Raw fetch with auth, one transparent refresh, and normalized errors. */
export async function request<T = unknown>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const access = tokens.access();
  if (access) headers.set("Authorization", `Bearer ${access}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401 && retry) {
    const fresh = await tryRefresh();
    if (fresh) return request<T>(path, init, false);
    tokens.clear();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = { detail: await res.text() };
    }
    throw toApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Download a generated document without ever persisting it server-side. */
export async function downloadDocx(
  body: Record<string, unknown>,
  fallbackName = "Resume.docx",
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const access = tokens.access();
  if (access) headers.set("Authorization", `Bearer ${access}`);

  const res = await fetch(`${API_URL}/api/v1/export/docx`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFrom(res.headers.get("content-disposition")) ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function filenameFrom(header: string | null): string | undefined {
  if (!header) return undefined;
  // Prefer RFC 5987 - it carries the real name when it has non-ASCII characters.
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1];
}
