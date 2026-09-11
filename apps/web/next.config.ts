import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The portal talks to FastAPI directly; the base URL is public config.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000",
  },
};

export default config;
