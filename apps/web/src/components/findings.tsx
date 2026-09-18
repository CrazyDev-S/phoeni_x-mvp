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
          All hard rules pass — no placeholders, exactly 4 skill categories, tenure
          arithmetic agrees with the claimed years.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {findings.map((f, i) => (
        <li key={`${f.rule_id}-${i}`} className="min-w-0 px-4 py-3">
          <div className="flex items-start gap-2">
            <StatusBadge tone={SEVERITY_TONE[f.severity]} className="mt-0.5 shrink-0">
              {f.severity}
            </StatusBadge>
            <div className="min-w-0 flex-1">
              <p className="text-sm break-words">{f.message}</p>
              {f.excerpt && (
                <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                  {f.excerpt}
                </p>
              )}
              {f.suggested_fix && (
                <p className="text-muted-foreground mt-1 text-xs">Fix: {f.suggested_fix}</p>
              )}
            </div>
            <code className="text-muted-foreground shrink-0 font-mono text-[10px]">
              {f.rule_id}
            </code>
          </div>
        </li>
      ))}
    </ul>
  );
}
