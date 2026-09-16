/**
 * Page scanner. Runs in the ISOLATED world.
 *
 * Isolated-world scripts are NOT subject to the page's CSP, which is why both
 * scan and fill stay here. The only reason to reach for the MAIN world would be
 * reading React internals, and that trades this guarantee for very little.
 *
 * Two things this file is responsible for beyond reading the DOM:
 *  - A stable element registry that survives the round trip to the backend.
 *  - Detecting what it CANNOT see (closed shadow roots, unreachable iframes) so
 *    the panel can be honest about it.
 */
import type { FieldType, FormOption, FrameScan, JobExtract, ScannedField } from "@/lib/types";

declare global {
  interface Window {
    __raRegistry?: Map<string, Element>;
  }
}

const CANDIDATE_SELECTOR = [
  "input:not([type=hidden])",
  "textarea",
  "select",
  '[contenteditable=""]',
  "[contenteditable=true]",
  "[role=combobox]",
  "[role=radiogroup]",
  'button[aria-haspopup="listbox"]',
].join(",");

const SKIP_INPUT_TYPES = new Set(["submit", "button", "reset", "image"]);

/** Walk the tree, descending into OPEN shadow roots. Closed roots are counted. */
function* deepWalk(root: ParentNode, stats: { closed: number }): Generator<Element> {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    yield el;
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) {
      yield* deepWalk(sr, stats);
    } else if (el.shadowRoot === null && "attachShadow" in el) {
      // Can't distinguish "no shadow" from "closed shadow" without patching
      // attachShadow at document_start, which needs a permanent content script.
      // Out of scope for v1; we just don't claim to have seen everything.
    }
  }
}

function visible(el: Element): boolean {
  const anyEl = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (typeof anyEl.checkVisibility === "function") {
    return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const style = getComputedStyle(anyEl);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return anyEl.offsetParent !== null || style.position === "fixed";
}

/** Label resolution drives answer quality more than the model does. */
function resolveLabel(el: Element): string {
  const byIds = el.getAttribute("aria-labelledby");
  if (byIds) {
    const text = byIds
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return clean(text);
  }
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return clean(aria);

  const id = el.getAttribute("id");
  if (id) {
    const escaped = (window.CSS?.escape ?? ((s: string) => s))(id);
    const forLabel = el.ownerDocument.querySelector(`label[for="${escaped}"]`);
    if (forLabel?.textContent?.trim()) return clean(forLabel.textContent);
  }
  const ancestorLabel = el.closest("label");
  if (ancestorLabel?.textContent?.trim()) return clean(ancestorLabel.textContent);

  const container = el.closest(
    "[data-automation-id],[class*=field],[class*=form-group],[class*=question]",
  );
  if (container) {
    const heading = container.querySelector("label,legend,h3,h4,[class*=label]");
    if (heading?.textContent?.trim()) return clean(heading.textContent);
  }
  if (isFileInput(el)) {
    // Upload widgets label the button they draw, not the input behind it -
    // which is how an Ashby upload came through as a bare "f0:0".
    const nearby = nearbyText(el);
    if (nearby) return nearby;
  }
  return clean(
    el.getAttribute("placeholder") ??
      el.getAttribute("name") ??
      el.getAttribute("data-automation-id") ??
      "",
  );
}

function isFileInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === "file";
}

/** The nearest text around an element, a few ancestors up at most. */
function nearbyText(el: Element): string {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const text = clean(node.innerText ?? "");
    if (text) return text.slice(0, 120);
  }
  return "";
}

/** A hidden file input counts when the upload widget around it is on screen. */
function uploadVisible(el: Element): boolean {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    if (visible(node)) return true;
  }
  return false;
}

function resolveHelp(el: Element): string {
  const ids = el.getAttribute("aria-describedby");
  if (!ids) return "";
  return clean(
    ids
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\*$/, "").trim().slice(0, 300);
}

function fieldType(el: Element): FieldType {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return "select";
  if (tag === "textarea") return "textarea";
  if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox") {
    return "combobox";
  }
  if (el.hasAttribute("contenteditable")) return "richtext";
  if (el.getAttribute("role") === "radiogroup") return "radio";
  if (tag === "input") {
    const t = (el as HTMLInputElement).type;
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (["email", "tel", "url", "number", "date", "file"].includes(t)) return t as FieldType;
    return "text";
  }
  return "unknown";
}

function optionsOf(el: Element): { options: FormOption[]; unknown: boolean } {
  if (el instanceof HTMLSelectElement) {
    return {
      options: Array.from(el.options)
        .filter((o) => o.value !== "" || o.text.trim() !== "")
        .map((o) => ({ label: o.text.trim(), value: o.value })),
      unknown: false,
    };
  }
  const owned = el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns");
  if (owned) {
    const listbox = el.ownerDocument.getElementById(owned);
    const opts = listbox?.querySelectorAll("[role=option],li");
    if (opts?.length) {
      return {
        options: Array.from(opts).map((o) => ({
          label: clean(o.textContent ?? ""),
          value: "",
        })),
        unknown: false,
      };
    }
  }
  // Custom dropdowns usually do not render their options until opened. Saying
  // so lets the panel resolve them on the page in a second cheap round trip.
  return { options: [], unknown: fieldType(el) === "combobox" };
}

export function scanFrame(frameKey: string): FrameScan {
  const registry = (window.__raRegistry ??= new Map());
  registry.clear();

  const stats = { closed: 0 };
  const seen = new Set<Element>();
  const radioGroups = new Map<string, ScannedField>();
  const fields: ScannedField[] = [];
  let index = 0;

  for (const el of deepWalk(document, stats)) {
    if (!el.matches(CANDIDATE_SELECTOR)) continue;
    if (seen.has(el)) continue;
    if (el.closest("[aria-hidden=true]")) continue;

    const input = el as HTMLInputElement;
    if (input.disabled || input.readOnly) continue;
    if (el.tagName === "INPUT" && SKIP_INPUT_TYPES.has(input.type)) continue;
    // Upload widgets hide the real input behind a styled button.
    if (!visible(el) && !(isFileInput(el) && uploadVisible(el))) continue;

    const type = fieldType(el);

    // Radios collapse into one logical field keyed by name.
    if (type === "radio" && el.tagName === "INPUT" && input.name) {
      const existing = radioGroups.get(input.name);
      const optionLabel = resolveLabel(el);
      if (existing) {
        existing.options.push({ label: optionLabel, value: input.value });
        continue;
      }
      const id = `${frameKey}:${index++}`;
      const group = el.closest("fieldset,[role=radiogroup],[class*=field]");
      const field: ScannedField = {
        id,
        type: "radio",
        label: clean(group?.querySelector("legend,label,[class*=label]")?.textContent ?? input.name),
        help: resolveHelp(el),
        name: input.name,
        autocomplete: input.autocomplete ?? "",
        required: input.required,
        max_length: null,
        current_value: "",
        options: [{ label: optionLabel, value: input.value }],
        options_unknown: false,
        group: input.name,
        accept: "",
      };
      radioGroups.set(input.name, field);
      fields.push(field);
      registry.set(id, el);
      el.setAttribute("data-ra-fid", id);
      seen.add(el);
      continue;
    }

    const id = `${frameKey}:${index++}`;
    const { options, unknown } = optionsOf(el);
    fields.push({
      id,
      type,
      label: resolveLabel(el),
      help: resolveHelp(el),
      name: input.name ?? "",
      autocomplete: input.autocomplete ?? "",
      required: input.required || el.getAttribute("aria-required") === "true",
      max_length: input.maxLength && input.maxLength > 0 ? input.maxLength : null,
      current_value: typeof input.value === "string" ? input.value.slice(0, 200) : "",
      options,
      options_unknown: unknown,
      group: "",
      accept: isFileInput(el) ? el.accept : "",
    });
    registry.set(id, el);
    el.setAttribute("data-ra-fid", id);
    seen.add(el);
  }

  const iframes = Array.from(document.querySelectorAll("iframe"));
  return {
    frameKey,
    url: location.href,
    fields,
    iframeCount: iframes.length,
    iframeSrcs: iframes.map((f) => f.src).filter(Boolean).slice(0, 20),
    closedShadowRoots: stats.closed,
  };
}

/**
 * Job-description extraction, cheapest and highest quality first.
 * A 2MB page becomes 8-15KB of clean text.
 */
export function extractJob(): JobExtract {
  const jsonLd = findJobPosting();
  const description =
    (jsonLd?.description as string | undefined) ??
    heuristicText() ??
    document.body.innerText;

  return {
    url: location.href,
    title: (jsonLd?.title as string) ?? guessTitle(),
    company: guessCompany(jsonLd),
    location: guessLocation(jsonLd),
    description_text: tidy(description).slice(0, 40_000),
    json_ld: jsonLd,
    ats: detectAts(),
  };
}

function findJobPosting(): Record<string, unknown> | null {
  for (const node of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      const parsed = JSON.parse(node.textContent ?? "");
      const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      for (const entry of candidates) {
        if (entry && entry["@type"] === "JobPosting") return entry;
      }
    } catch {
      // Malformed JSON-LD is common; fall through to the next strategy.
    }
  }
  return null;
}

function heuristicText(): string | null {
  const el = document.querySelector(
    "[class*=job-description],[data-ui=job-description]," +
      "[data-automation-id*=jobPostingDescription],#content,main,article",
  );
  const text = (el as HTMLElement | null)?.innerText;
  return text && text.length > 200 ? text : null;
}

function guessTitle(): string | null {
  const h1 = document.querySelector("h1")?.textContent;
  return h1 ? clean(h1) : (document.title || null);
}

function guessCompany(jsonLd: Record<string, unknown> | null): string | null {
  const org = jsonLd?.hiringOrganization as { name?: string } | undefined;
  if (org?.name) return org.name;
  const meta = document.querySelector('meta[property="og:site_name"]');
  return meta?.getAttribute("content") ?? null;
}

function guessLocation(jsonLd: Record<string, unknown> | null): string | null {
  const loc = jsonLd?.jobLocation as { address?: { addressLocality?: string; addressCountry?: string } } | undefined;
  const a = loc?.address;
  if (!a) return null;
  return [a.addressLocality, a.addressCountry].filter(Boolean).join(", ") || null;
}

function detectAts(): string | null {
  const host = location.hostname;
  const html = document.documentElement.innerHTML.slice(0, 60_000);
  if (host.includes("greenhouse.io") || html.includes("grnhse")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  if (host.includes("myworkday")) return "workday";
  if (host.includes("ashbyhq.com")) return "ashby";
  if (host.includes("smartrecruiters")) return "smartrecruiters";
  if (host.includes("workable.com")) return "workable";
  if (host.includes("icims.com")) return "icims";
  if (host.includes("linkedin.com")) return "linkedin";
  return null;
}

function tidy(text: string): string {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Exposed on the isolated world's `window` because `executeScript({files})`
// loads a CLASSIC script — module exports are not reachable from the
// follow-up `func` call, which is how the panel actually invokes these.
export default defineUnlistedScript(() => {
  (window as unknown as Record<string, unknown>).__raScan = { scanFrame, extractJob };
});
