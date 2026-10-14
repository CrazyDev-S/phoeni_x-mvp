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
      <div className="text-muted-foreground flex items-start gap-2.5 px-4 py-6 text-sm">
        <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />
        <p>
          All hard rules pass — no placeholders, exactly 4 skill categories,
          tenure arithmetic agrees with the claimed years.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {findings.map((f, i) => (
        <li
          key={`${f.rule_id}-${i}`}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-5 py-[1.125rem] sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:px-6"
        >
          <StatusBadge
            tone={SEVERITY_TONE[f.severity]}
            className="mt-0.5 self-start"
          >
            {f.severity}
          </StatusBadge>
          <div className="min-w-0">
            <p className="text-sm leading-snug font-semibold break-words">
              {f.message}
            </p>
            {f.excerpt && (
              <p className="bg-soft text-foreground/70 mt-2 truncate rounded-[10px] px-2.5 py-1.5 font-mono text-xs">
                {f.excerpt}
              </p>
            )}
            {f.suggested_fix && (
              <p className="text-muted-foreground mt-2 text-[0.8125rem] leading-snug">
                <b className="text-foreground font-bold">Fix:</b>{" "}
                {f.suggested_fix}
              </p>
            )}
          </div>
          <code className="text-subtle col-span-2 pt-1 font-mono text-[10.5px] font-semibold sm:col-span-1">
            {f.rule_id}
          </code>
        </li>
      ))}
    </ul>
  );
}
