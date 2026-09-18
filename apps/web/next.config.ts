import type { NextConfig } from "next";

/**
 * Hosts allowed to load dev-only assets (fonts, HMR) when the dev server is
 * reached from a browser on another machine.
 *
 * Next blocks these cross-origin by default. It expects a list of hosts —
 * `"*"` is rejected by the config schema, which is why setting it appears to
 * do nothing. Set ALLOWED_DEV_ORIGINS to a comma-separated list of hostnames
 * or IPs (no scheme, no port). Development only; it has no effect on a build.
 */
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const config: NextConfig = {
  reactStrictMode: true,
  // Next writes AGENTS.md and CLAUDE.md into the app directory otherwise.
  agentRules: false,
  // The browser calls FastAPI directly, so this must be a URL the BROWSER can
  // reach — not 127.0.0.1, when the browser is on a different machine.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000",
  },
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default config;
