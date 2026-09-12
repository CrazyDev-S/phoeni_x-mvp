"use client";

import { Badge } from "./ui";

export interface Finding {
  rule_id: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
  excerpt?: string;
  suggested_fix?: string;
}

/**
 * The validation panel.
 *
 * These are the generator prompt's hard rules, re-checked in Python rather
 * than taken on the model's word. Errors are shown as blocking because they
 * are: an error stops the extension's one-click download.
 */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (!findings.length) {
    return (
      <p className="px-4 py-6 text-sm text-[var(--color-ink-soft)]">
        All hard rules pass — no placeholders, exactly 4 skill categories, tenure
        arithmetic agrees with the claimed years.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {findings.map((f, i) => (
        <li key={`${f.rule_id}-${i}`} className="min-w-0 px-4 py-3">
          <div className="flex items-start gap-2">
            <Badge tone={f.severity === "error" ? "bad" : f.severity === "warning" ? "warn" : "neutral"}>
              {f.severity}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="text-sm break-words">{f.message}</p>
              {f.excerpt && (
                <p className="mono mt-1 truncate text-xs text-[var(--color-ink-soft)]">
                  {f.excerpt}
                </p>
              )}
              {f.suggested_fix && (
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  Fix: {f.suggested_fix}
                </p>
              )}
            </div>
            <code className="shrink-0 text-[10px] text-[var(--color-ink-soft)]">
              {f.rule_id}
            </code>
          </div>
        </li>
      ))}
    </ul>
  );
}
