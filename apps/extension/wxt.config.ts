import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Tailwind v4 is a Vite plugin rather than a PostCSS step; WXT hands its own
  // Vite config through this hook.
  vite: () => ({ plugins: [tailwindcss()] }),
  // Without this the archive is named after the package ("resume-assistextension").
  zip: { name: "phoenix-eye" },
  // Conventional layout: entrypoints live under srcDir, and WXT's default
  // "@" alias resolves to srcDir, so "@/lib/..." just works.
  srcDir: "src",
  // No "icons" key: WXT picks up public/icon/<size>.png, which `npm run brand`
  // writes.
  manifest: {
    name: "Phoenix Eye",
    description:
      "Tailor your resume to the job you have open, fill the application, and track it.",
    version: "0.1.0",
    // chrome.sidePanel.open() requires 116+.
    minimum_chrome_version: "116",

    // NOTE: deliberately NO "default_popup" - a popup wins over the side panel.
    action: { default_title: "Open Phoenix Eye" },
    side_panel: { default_path: "sidepanel.html" },

    permissions: [
      "sidePanel",
      "scripting", // executeScript for scan + fill, injected on demand
      "storage",
      "tabs", // tab.url/title for arbitrary tabs, and tab-change events
      "downloads", // deterministic filenames + a real completion signal
      "alarms", // refresh the next-call badge while the panel is closed
    ],
    optional_permissions: ["notifications"],

    // activeTab is deliberately NOT used: it grants the tab's MAIN FRAME origin
    // only, so it cannot read a Greenhouse or Lever form inside an iframe -
    // which is most application forms.
    host_permissions: ["<all_urls>"],

    // Empty on purpose. Sites probe for known extension IDs by requesting
    // web-accessible resources; shipping none makes that probe fail.
    web_accessible_resources: [],

    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+J" },
        description: "Open Phoenix Eye",
      },
    },
  },
});
