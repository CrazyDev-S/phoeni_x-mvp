"use client";

import { CheckCircle2 } from "lucide-react";

import { StatusBadge, type Tone } from "@/components/status-badge";

export interface Finding {
  rule_id: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
  excerpt?: string;
  suggested_fix?: string;
}

const SEVERITY_TONE: Record<Finding["severity"], Tone> = {
  error: "bad",
  warning: "warn",
  info: "neutral",
};

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
      <div className="text-muted-foreground flex items-center gap-2 px-3 py-3 text-xs">
        <CheckCircle2 className="text-success size-4 shrink-0" />
        All hard rules pass.
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {findings.map((f, i) => (
        <li
          key={`${f.rule_id}-${i}`}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-3 py-2 sm:grid-cols-[4rem_minmax(0,1fr)_auto]"
        >
          <StatusBadge
            tone={SEVERITY_TONE[f.severity]}
            className="mt-0.5 self-start"
          >
            {f.severity}
          </StatusBadge>
          <div className="min-w-0">
            <p className="text-[13px] leading-snug font-medium break-words">
              {f.message}
            </p>
            {f.excerpt && (
              <p className="bg-muted text-foreground/70 mt-1 truncate rounded px-2 py-1 font-mono text-xs">
                {f.excerpt}
              </p>
            )}
            {f.suggested_fix && (
              <p className="text-muted-foreground mt-1 text-xs leading-snug">
                <b className="text-foreground font-semibold">Fix:</b>{" "}
                {f.suggested_fix}
              </p>
            )}
          </div>
          <code className="text-subtle col-span-2 font-mono text-[10.5px] sm:col-span-1">
            {f.rule_id}
          </code>
        </li>
      ))}
    </ul>
  );
}
