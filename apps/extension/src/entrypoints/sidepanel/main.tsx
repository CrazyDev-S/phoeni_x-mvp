import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./style.css";

/**
 * The panel has no theme switch of its own - it is a strip of browser chrome,
 * so it follows whatever the browser is set to.
 */
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (matches: boolean) => {
  document.documentElement.classList.toggle("dark", matches);
  document.documentElement.style.colorScheme = matches ? "dark" : "light";
};
applyTheme(dark.matches);
dark.addEventListener("change", (event) => applyTheme(event.matches));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
