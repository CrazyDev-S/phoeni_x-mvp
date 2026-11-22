/**
 * Reading Upwork postings off the page, for the shared job list.
 *
 * This knows as little about Upwork as it can: where a posting is on the page
 * (a block holding links to exactly one job, or the job's own page), its key,
 * title, description and skill tokens. Everything else goes up as the page
 * shows it - the block's visible text, and every element Upwork names with
 * data-test / data-qa - and the backend reads Upwork's wording
 * (backend/app/freelancing/capture.py). When Upwork changes its pages, the fix
 * lands on the server, not in a new extension build.
 *
 * Nothing here makes a request to Upwork: it reads what the user already has
 * open, and nothing at all outside the job-browsing pages.
 */

export interface CapturedJob {
  upwork_id: string;
  view: "tile" | "detail";
  url: string;
  title: string | null;
  description: string | null;
  skills: string[];
  labels: Record<string, string>;
  text: string;
}

// "~021858964253717283346", or "~01" and hex for older postings.
const KEY = /~0[12][0-9a-f]{10,40}/i;

// Where postings are listed or shown. Proposals, messages, contracts and the
// account pages are never read: what is on them is the user's own business.
const JOB_PAGES = /^\/(nx\/search\/jobs|nx\/find-work|nx\/jobs|jobs\/|freelance-jobs\/|ab\/jobs\/)/;
// A posting's own address: /jobs/~key, a slide-over's .../details/~key, /freelance-jobs/...~key.
const JOB_PATH = /\/(jobs|details|freelance-jobs|job)\/.*~0[12][0-9a-f]{10,}/i;
// A page that is one posting and nothing else: no list behind it, unlike a slide-over.
const OWN_PAGE = /^\/(jobs|freelance-jobs|ab\/jobs)\/.*~0[12][0-9a-f]{10,}/i;
// Upwork's proposal form for a posting. Never read - it is the user's own draft.
const APPLY_PAGE = /^\/nx\/proposals\/job\/~0[12][0-9a-f]{10,}/i;
// A client's past contracts, on a posting's page. Their links go to closed jobs
// and to the freelancers who did them - never to a posting anyone can bid on.
const HISTORY_TITLE = '[data-test="work-history-title"]';
const HISTORY_LIST = '[data-test="jobs"]';

const DESCRIPTION = [
  '[data-test="Description"]',
  '[data-test="job-description"]',
  '[data-test*="JobDescription"]',
  '[data-test="job-description-text"]',
  ".job-description",
].join(",");
const SKILL_TOKENS = [
  '[data-test="token"]',
  '[data-test="Skill"]',
  '[data-test="attr-item"]',
  '[data-test*="TokenClamp"] button',
  ".air3-token",
].join(",");
const LABELLED = "[data-test], [data-qa], [data-cy], [data-testid]";
const DETAIL_ROOTS = [
  '[data-test="job-details-viewer"]',
  '[data-test="JobDetails"]',
  ".job-details-content",
  ".air3-slider-content",
  '[role="dialog"]',
].join(",");
const NOT_A_TITLE = /^(about the client|similar jobs|activity on this job|skills and expertise|summary|job details)$/i;

export function jobKey(text: string | null | undefined): string | null {
  const match = text?.match(KEY);
  return match ? match[0].toLowerCase() : null;
}

export function readsJobs(location: Location): boolean {
  return location.hostname.endsWith("upwork.com") && JOB_PAGES.test(location.pathname);
}

/**
 * The one posting a tab is about - its own page, a list's slide-over, or its
 * proposal form - or null for a list. The panel focuses on that posting alone.
 */
export function postingIn(url: string | undefined): string | null {
  let path: string;
  try {
    const parsed = new URL(url ?? "");
    if (parsed.hostname !== "www.upwork.com") return null;
    path = parsed.pathname;
  } catch {
    return null;
  }
  return OWN_PAGE.test(path) || APPLY_PAGE.test(path) || /\/details\/~/i.test(path) ? jobKey(path) : null;
}

/** Upwork's proposal form, where a letter is pasted rather than a posting read. */
export function isApplyPage(url: string | undefined): boolean {
  try {
    return APPLY_PAGE.test(new URL(url ?? "").pathname);
  } catch {
    return false;
  }
}

/** Visible text, line by line, as the page renders it. */
function visibleText(el: Element, cap = 60_000): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, cap);
}

function shortText(el: Element): string {
  return visibleText(el, 2000);
}

/**
 * The posting a link goes to, read from its path alone: a query can carry
 * another page's address, as a freelancer profile's referrer does.
 */
function postingKey(link: HTMLAnchorElement): string | null {
  let path: string;
  try {
    path = new URL(link.href).pathname;
  } catch {
    return null;
  }
  return JOB_PATH.test(path) ? jobKey(path) : null;
}

function keysUnder(el: Element): Set<string> {
  const keys = new Set<string>();
  for (const a of el.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const key = postingKey(a);
    if (key) keys.add(key);
  }
  return keys;
}

/** The blocks listing a client's past contracts: each from its heading to the list it opens. */
function histories(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(HISTORY_TITLE), (heading) => {
    for (let node = heading.parentElement, i = 0; node && i < 5; node = node.parentElement, i++) {
      if (node.querySelector(HISTORY_LIST)) return node;
    }
    return heading.parentElement ?? heading;
  });
}

/**
 * The block a job link belongs to: the largest ancestor that still holds
 * links to that one job only. It finds tiles in a search list, a feed, or the
 * "similar jobs" rail alike, without knowing how any of them is built.
 */
function tileOf(link: Element, key: string, stop: Element): Element {
  let node: Element = link;
  while (node.parentElement && node.parentElement !== stop && node !== stop) {
    const parent = node.parentElement;
    const keys = keysUnder(parent);
    if (keys.size > 1 || (keys.size === 1 && !keys.has(key))) break;
    // A lone result can climb to the page itself; a tile is never that long.
    // textContent, not innerText: measuring must not force a layout per level.
    if ((parent.textContent ?? "").length > 15_000) break;
    node = parent;
  }
  return node;
}

function labels(root: Element, skip: Element | null): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const el of root.querySelectorAll(LABELLED)) {
    if (count >= 150) break;
    if (skip && (el === skip || skip.contains(el))) continue;
    const name =
      el.getAttribute("data-test") ?? el.getAttribute("data-qa") ?? el.getAttribute("data-cy") ?? el.getAttribute("data-testid");
    if (!name) continue;
    const value = shortText(el);
    if (!value) continue;
    if (out[name]) {
      if (!out[name].includes(value)) out[name] = `${out[name]} | ${value}`.slice(0, 2000);
    } else {
      out[name] = value;
      count += 1;
    }
  }
  return out;
}

function skills(root: Element): string[] {
  const out: string[] = [];
  const add = (text: string) => {
    const skill = text.replace(/\s+/g, " ").trim();
    if (skill && skill.length <= 60 && !/^\+?\d+( more)?$/i.test(skill) && !out.includes(skill)) out.push(skill);
  };
  root.querySelectorAll(SKILL_TOKENS).forEach((el) => add(el.textContent ?? ""));
  if (out.length) return out.slice(0, 60);
  // The posting's own page lists skills under a heading rather than as tokens.
  for (const heading of root.querySelectorAll("h2, h3, h4, h5, strong")) {
    if (!/skills and expertise|mandatory skills|nice-to-have skills/i.test(heading.textContent ?? "")) continue;
    const section = heading.closest("section") ?? heading.parentElement;
    section?.querySelectorAll("a, span, li").forEach((el) => {
      if (!el.children.length && el !== heading && !/skills/i.test(el.textContent ?? "")) add(el.textContent ?? "");
    });
  }
  return out.slice(0, 60);
}

function title(root: Element, fallback?: string | null): string | null {
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, [data-test='job-title']")) {
    const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length >= 4 && text.length <= 300 && !NOT_A_TITLE.test(text)) return text;
  }
  return fallback?.trim() || null;
}

function capture(root: Element, key: string, view: CapturedJob["view"], url: string, titleText: string | null): CapturedJob {
  const description = root.querySelector(DESCRIPTION);
  return {
    upwork_id: key,
    view,
    url,
    title: titleText,
    description: description ? visibleText(description, 30_000) : null,
    skills: skills(root),
    labels: labels(root, description),
    text: visibleText(root),
  };
}

/** The posting open on this page (its own page, or a search's slide-over), if any. */
function detail(doc: Document, location: Location): { job: CapturedJob; root: Element } | null {
  const key = jobKey(location.pathname);
  if (!key) return null;
  const candidates = Array.from(doc.querySelectorAll(DETAIL_ROOTS)).filter((el) => visibleText(el, 400).length > 200);
  const root = candidates[0] ?? doc.querySelector("main") ?? doc.body;
  const pageTitle = doc.title.split(/\s+[-|–]\s+/)[0];
  return { job: capture(root, key, "detail", `https://www.upwork.com/jobs/${key}`, title(root, pageTitle)), root };
}

/** Every posting on the page: the open one, and each tile listed. */
export function harvest(doc: Document, location: Location): CapturedJob[] {
  if (!readsJobs(location)) return [];
  const out: CapturedJob[] = [];
  const open = detail(doc, location);
  if (open) out.push(open.job);
  // A posting's own page is that posting alone: its "similar jobs" rail and the
  // client's other openings are not what the user opened, so they are not sent.
  if (open && OWN_PAGE.test(location.pathname)) return out;

  const seen = new Set<string>();
  const body = doc.body;
  const past = histories(doc);
  for (const link of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const key = postingKey(link);
    if (!key || seen.has(key)) continue;
    // Links to the open posting are its own: Apply and Save, and on a search the
    // paging and sorting links, which carry the open slide-over in their address.
    if (open && key === open.job.upwork_id) continue;
    if (past.some((block) => block.contains(link))) continue;
    seen.add(key);
    const tile = tileOf(link, key, body);
    const url = new URL(link.href);
    out.push(capture(tile, key, "tile", `${url.origin}${url.pathname}`, (link.textContent ?? "").replace(/\s+/g, " ").trim() || title(tile)));
  }
  return out;
}

/** A cheap fingerprint, so an unchanged posting is not sent again. */
export function fingerprint(job: CapturedJob): string {
  const text = `${job.title}|${job.description}|${job.skills.join(",")}|${job.text}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${job.view}:${hash}`;
}
