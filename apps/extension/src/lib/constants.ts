export const API_BASE_KEY = "apiBase";
export const TOKEN_KEY = "apiToken";
export const NEXT_CALL_KEY = "nextCall";
export const BASE_RESUME_KEY = "baseResumeId";
// Whether Apply generates a new resume per posting or tailors the base resume.
export const MODE_KEY = "applyMode";
export const ROUTE_KEY = "route";
export const PORTAL_URL_KEY = "portalUrl";
// Upwork capture: on unless paused, today's tally, and what each tab shows.
export const UPWORK_PAUSED_KEY = "upworkPaused";
export const UPWORK_STATS_KEY = "upworkStats";
export const UPWORK_TAB_PREFIX = "upworkTab:";
// A search or feed left open is refreshed this often, for postings made since.
export const UPWORK_CHECK_MS = 5 * 60_000;
export const UPWORK_CONTENT_SCRIPT = "content-scripts/upwork.js";
// Relays the portal's "refresh Upwork now"; registered at runtime for the portal URL.
export const PORTAL_BRIDGE_SCRIPT = "content-scripts/portal-bridge.js";

export const DEFAULT_API_BASE = "http://127.0.0.1:8000";
export const DEFAULT_PORTAL_URL = "http://127.0.0.1:3000";
