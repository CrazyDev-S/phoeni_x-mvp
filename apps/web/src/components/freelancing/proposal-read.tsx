"use client";

import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

import { Panel, PanelHead } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { versionLabel, type ProposalSpike, type ProposalVersion } from "@/lib/proposal-writer";

const BASIS: Record<Exclude<ProposalSpike["basis"], "">, { label: string; tone: "ok" | "warn" }> = {
  profile: { label: "From your profile", tone: "ok" },
  instructions: { label: "From your instruction", tone: "ok" },
  plan: { label: "A plan, not past work", tone: "warn" },
};

/**
 * What the writer saw in the posting before it wrote: the method's four
 * detective answers, and where the experience spike came from. The client
 * never sees this; it is how the freelancer checks the letter's aim.
 */
export function ProposalRead({ version }: { version: ProposalVersion }) {
  const { read, spike, researched } = version.document;
  if (!read?.fear && !spike?.name) return null;
  const basis = spike?.basis ? BASIS[spike.basis] : null;

  const rows: [string, ReactNode][] = [
    ["Fear", read?.fear],
    ["Anchor", read?.anchor],
    ["Outcome", read?.outcome],
    ["Mirror", read?.mirror],
  ];

  return (
    <Panel>
      <PanelHead title="The read" count={versionLabel(version)} />
      <dl className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 px-3 py-2.5 text-[13px]">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground pt-px text-xs">{label}</dt>
              <dd className="min-w-0 leading-snug">{value}</dd>
            </div>
          ))}
      </dl>

      {spike?.name && (
        <section className="space-y-1 border-t px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-muted-foreground text-xs">Experience spike</h3>
            {basis && <StatusBadge tone={basis.tone}>{basis.label}</StatusBadge>}
          </div>
          <p className="text-[13px] font-semibold">{spike.name}</p>
          {spike.source && <p className="text-muted-foreground text-xs">{spike.source}</p>}
        </section>
      )}

      {researched && researched.length > 0 && (
        <ul className="space-y-1 border-t px-3 py-2.5 text-xs" aria-label="Pages read">
          {researched.map((page) => (
            <li key={page.url} className="flex items-start gap-1.5" title={page.problem || page.url}>
              {page.problem ? (
                <X className="text-destructive mt-px size-3.5 shrink-0" />
              ) : (
                <Check className="text-success mt-px size-3.5 shrink-0" />
              )}
              <span className="min-w-0">
                <span className="block truncate">{page.title || hostOf(page.url)}</span>
                {page.problem && <span className="text-muted-foreground">{page.problem}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
