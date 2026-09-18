/**
 * Fill engine. ISOLATED world.
 *
 * The central problem: React (and Vue/Angular/Svelte) install an instance-level
 * value tracker, so `el.value = x` is swallowed and the framework never learns
 * about the change. The fix is to call the NATIVE prototype setter and clear
 * the tracker first, then dispatch the events a real user would produce.
 *
 * `composed: true` on every event is not optional — without it, an event raised
 * inside a shadow root never reaches a framework listening at the app root.
 */
import type { FileUpload, FillResult, FillStatus, FillStep as Instruction } from "@/lib/types";

declare global {
  interface Window {
    __raRegistry?: Map<string, Element>;
  }
}

const GAP_MS = 90; // sequential pacing; see fillAll()

function resolve(id: string): Element | null {
  const registry = window.__raRegistry;
  const direct = registry?.get(id);
  if (direct?.isConnected) return direct;
  // The SPA re-rendered the node. The attribute usually survives because React
  // preserves unknown attributes unless it recreates the element outright.
  return document.querySelector(`[data-ra-fid="${CSS.escape(id)}"]`);
}

function nativeSetter(el: Element): ((v: string) => void) | null {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : null;
  if (!proto) return null;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  return descriptor?.set ? descriptor.set.bind(el) : null;
}

function setNativeValue(el: Element, value: string): void {
  // Force React's tracker to see a delta, or it will treat the set as a no-op.
  const tracked = el as Element & { _valueTracker?: { setValue(v: string): void } };
  tracked._valueTracker?.setValue("");
  const setter = nativeSetter(el);
  if (setter) setter(value);
  else (el as HTMLElement & { value?: string }).value = value;
}

function fire(el: Element, type: string, init: EventInit = {}): void {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));
}

function fireInput(el: Element, data: string): void {
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data,
    }),
  );
}

function pointerClick(el: Element): void {
  const opts = { bubbles: true, composed: true, cancelable: true } as const;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, opts));
  }
}

function pressKey(el: Element, key: string): void {
  for (const type of ["keydown", "keyup"]) {
    el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, composed: true }));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalise(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Exact → case-insensitive → normalised. Fuzzy matching stays server-side. */
function match<T>(items: T[], wanted: string, text: (item: T) => string): T | null {
  for (const item of items) if (text(item) === wanted) return item;
  const lower = wanted.toLowerCase();
  for (const item of items) if (text(item).toLowerCase().trim() === lower) return item;
  const norm = normalise(wanted);
  for (const item of items) if (normalise(text(item)) === norm) return item;
  return null;
}

async function fillText(el: Element, value: string): Promise<void> {
  el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
  (el as HTMLElement).focus();
  setNativeValue(el, value);
  fireInput(el, value);
  fire(el, "change");
  // Some validators only run on keyup.
  el.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true, composed: true }));
  (el as HTMLElement).blur();
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
}

async function fillSelect(el: HTMLSelectElement, value: string): Promise<string[] | null> {
  const option = match(Array.from(el.options), value, (o) => o.text.trim());
  if (!option) return Array.from(el.options).map((o) => o.text.trim());
  setNativeValue(el, option.value);
  fire(el, "input");
  fire(el, "change");
  return null;
}

function fillRadio(el: Element, value: string): string[] | null {
  const name = (el as HTMLInputElement).name;
  const radios = Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`),
  );
  const labelOf = (r: HTMLInputElement) =>
    (r.closest("label")?.textContent ??
      document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent ??
      r.value ??
      "").replace(/\s+/g, " ").trim();

  const hit = match(radios, value, labelOf) ?? match(radios, value, (r) => r.value);
  if (!hit) return radios.map(labelOf);
  // click() produces the full pointer/mouse/click/change sequence every
  // framework honours; setting .checked does not.
  hit.click();
  return null;
}

async function fillCombobox(host: HTMLElement, value: string): Promise<string[] | null> {
  host.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  pointerClick(host);

  const listbox = await waitForListbox(host, 1500);
  const search =
    listbox?.querySelector("input") ??
    (host.matches("input") ? (host as HTMLInputElement) : null);

  if (search) {
    setNativeValue(search, value);
    fireInput(search, value);
    await sleep(250);
  }

  const scope: ParentNode = listbox ?? document;
  const options = Array.from(
    scope.querySelectorAll(
      '[role=option],li,[data-automation-id="promptOption"],[data-automation-id="menuItem"]',
    ),
  ).filter((o) => (o.textContent ?? "").trim());

  const hit = match(options, value, (o) => (o.textContent ?? "").replace(/\s+/g, " ").trim());
  if (!hit) {
    // Keyboard path: react-select and Headless UI ignore synthetic pointer
    // clicks on the option node but honour ArrowDown + Enter.
    if (search) {
      pressKey(search, "ArrowDown");
      pressKey(search, "Enter");
      await sleep(200);
      if (readValue(host)) return null;
    }
    pressKey(host, "Escape");
    return options.map((o) => (o.textContent ?? "").trim()).slice(0, 60);
  }
  pointerClick(hit);
  return null;
}

async function waitForListbox(host: Element, timeoutMs: number): Promise<Element | null> {
  const owned = host.getAttribute("aria-controls") ?? host.getAttribute("aria-owns");
  if (owned) {
    const el = document.getElementById(owned);
    if (el) return el;
  }
  // Listboxes are frequently PORTALED to document.body rather than rendered as
  // a descendant, so watching only the host's subtree misses them.
  return new Promise((resolve) => {
    const found = document.querySelector("[role=listbox]");
    if (found) return resolve(found);

    const observer = new MutationObserver(() => {
      const el = document.querySelector("[role=listbox]");
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector("[role=listbox]"));
    }, timeoutMs);
  });
}

/**
 * Attach a file the way the file picker would.
 *
 * `input.files` takes a FileList built with DataTransfer, and upload widgets
 * (react-dropzone, Greenhouse, Lever, Ashby) read the file from the change
 * event. What cannot be read back is whether the site accepted it: many
 * widgets upload the file and clear the input straight away. So it counts as
 * filled only when the file's name shows on the page, or in a plain file input
 * still holding it; otherwise it is reported as unconfirmed, for the user to check.
 */
async function attachFile(input: HTMLInputElement, file: FileUpload): Promise<FillStatus> {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], file.name, { type: file.mime }));
  input.files = transfer.files;
  fire(input, "input");
  fire(input, "change");

  await sleep(1500);
  const stem = file.name.replace(/\.[^.]+$/, "");
  if (document.body.innerText.includes(stem)) return "filled";
  // A visible native file input shows the name in its own UI, not the page's text.
  const native = input.getClientRects().length > 0 && getComputedStyle(input).opacity !== "0";
  return native && input.files?.[0]?.name === file.name ? "filled" : "unconfirmed";
}

function readValue(el: Element): string {
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text.trim() ?? "";
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? "true" : "";
    if (el.type === "file") return el.files?.[0]?.name ?? "";
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el.hasAttribute("contenteditable")) return (el as HTMLElement).innerText;
  return (el as HTMLElement).innerText?.trim() ?? "";
}

async function fillOne(step: Instruction): Promise<FillResult> {
  const el = resolve(step.id);
  const base = { id: step.id, label: step.label ?? "", intended: step.answer ?? "" };

  if (!el) {
    return { ...base, status: "failed", observed: null, reason: "element-gone" };
  }
  if (step.type === "file") {
    if (!step.file) {
      return { ...base, status: "manual", observed: null, reason: "file-input" };
    }
    const attached = { ...base, intended: step.file.name };
    try {
      const status = await attachFile(el as HTMLInputElement, step.file);
      return {
        ...attached,
        status,
        observed: status === "filled" ? step.file.name : null,
        reason: status === "filled" ? "file-attached" : "check-the-upload",
      };
    } catch (error) {
      return {
        ...attached,
        status: "failed",
        observed: null,
        reason: String((error as Error).message ?? error).slice(0, 120),
      };
    }
  }

  let optionsSeen: string[] | null = null;
  try {
    switch (step.type) {
      case "select":
        optionsSeen = await fillSelect(el as HTMLSelectElement, step.answer ?? "");
        break;
      case "radio":
        optionsSeen = fillRadio(el, step.answer ?? "");
        break;
      case "checkbox": {
        const input = el as HTMLInputElement;
        if (input.checked !== Boolean(step.checked)) input.click();
        break;
      }
      case "combobox":
        optionsSeen = await fillCombobox(el as HTMLElement, step.answer ?? "");
        break;
      case "richtext": {
        (el as HTMLElement).focus();
        // Deprecated, but still the only route through a rich editor's own
        // input pipeline. ProseMirror/Quill discard a raw textContent write.
        const ok = document.execCommand("insertText", false, step.answer ?? "");
        if (!ok) {
          (el as HTMLElement).innerText = step.answer ?? "";
          fireInput(el, step.answer ?? "");
        }
        break;
      }
      default:
        await fillText(el, step.answer ?? "");
    }
  } catch (error) {
    return {
      ...base,
      status: "failed",
      observed: null,
      reason: String((error as Error).message ?? error).slice(0, 120),
    };
  }

  if (optionsSeen) {
    return {
      ...base,
      status: "failed",
      observed: null,
      reason: "option-not-found",
      optionsSeen,
    };
  }

  // Two-phase verification. A value that appears at t+150 and is gone at
  // t+1000 was reverted by the app — the classic controlled-input failure.
  await sleep(150);
  const early = readValue(el);
  await sleep(850);
  const late = readValue(el);

  const wanted = step.type === "checkbox" ? (step.checked ? "true" : "") : (step.answer ?? "");
  const matches = (v: string) =>
    step.type === "checkbox"
      ? v === wanted
      : normalise(v).includes(normalise(wanted).slice(0, 40)) || normalise(wanted).includes(normalise(v));

  let status: FillStatus = "failed";
  let reason: string | undefined;
  if (matches(late)) status = "filled";
  else if (matches(early)) {
    status = "reverted";
    reason = "reverted-by-app";
  }

  return { ...base, status, observed: late || null, reason };
}

export async function fillAll(steps: Instruction[]): Promise<FillResult[]> {
  const results: FillResult[] = [];
  // Sequential, with a gap. Parallel fills break cascading dependents
  // (country -> state -> city) and trip rate-limited validators.
  for (const step of steps) {
    results.push(await fillOne(step));
    await sleep(GAP_MS);
  }
  return results;
}

/** Open a combobox just to read its real options, for the resolve round trip. */
export async function readOptions(id: string): Promise<string[]> {
  const el = resolve(id);
  if (!el) return [];
  pointerClick(el as HTMLElement);
  const listbox = await waitForListbox(el, 1200);
  const scope: ParentNode = listbox ?? document;
  const options = Array.from(scope.querySelectorAll("[role=option],li"))
    .map((o) => (o.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  pressKey(el, "Escape");
  return options.slice(0, 200);
}

export default defineUnlistedScript(() => {
  (window as unknown as Record<string, unknown>).__raFill = { fillAll, readOptions };
});
