import { useSyncExternalStore } from "react";

/**
 * Which look a designed resume is drawn and downloaded in.
 *
 * One choice, kept on this device, read by the preview and by every download
 * button - so what the preview shows is what the file contains. `null` means
 * "the server's default": the first template, at its own colour. The list of
 * templates and colours comes from the server, so nothing here names one.
 */
export interface ResumeStyle {
  template: string | null;
  accent: string | null;
}

const KEY = "ra.resume-style";
const EMPTY: ResumeStyle = { template: null, accent: null };

let cached: ResumeStyle | null = null;
const listeners = new Set<() => void>();

function load(): ResumeStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return {
      template: typeof raw?.template === "string" ? raw.template : null,
      accent: typeof raw?.accent === "string" && /^[0-9A-F]{6}$/i.test(raw.accent) ? raw.accent : null,
    };
  } catch {
    return EMPTY;
  }
}

export function getResumeStyle(): ResumeStyle {
  if (typeof window === "undefined") return EMPTY;
  return (cached ??= load());
}

export function setResumeStyle(patch: Partial<ResumeStyle>): void {
  cached = { ...getResumeStyle(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode: the choice lasts for this page view, which is still useful.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cached = null;
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function useResumeStyle(): ResumeStyle {
  return useSyncExternalStore(subscribe, getResumeStyle, () => EMPTY);
}

/** The fields to send with an export or preview request; empty for the defaults. */
export function styleFields(style: ResumeStyle = getResumeStyle()): { template?: string; accent?: string } {
  return {
    ...(style.template ? { template: style.template } : {}),
    ...(style.accent ? { accent: style.accent } : {}),
  };
}
