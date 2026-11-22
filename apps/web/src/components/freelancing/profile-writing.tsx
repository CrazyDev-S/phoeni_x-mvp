"use client";

import { Check, Copy, CornerLeftDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Panel, PanelHead } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isSaved,
  versionLabel,
  type EducationEntry,
  type ProfileVersion,
  type StackBrief,
  type WorkEntry,
} from "@/lib/profile-writer";
import { cn } from "@/lib/utils";

/**
 * What the writer wrote that the form has no field for: the title options,
 * work history, education, portfolio plan, certification roadmap and the
 * intelligence brief behind it all. Everything copies out ready for Upwork.
 */
export function ProfileWriting({
  version,
  title,
  onUseTitle,
}: {
  version: ProfileVersion;
  /** The form's title now, so the option in use says so. */
  title: string;
  onUseTitle: (title: string) => void;
}) {
  const doc = version.document;
  const tabs = [
    { key: "titles", label: "Titles", count: doc.titles?.length },
    { key: "work", label: "Work history", count: doc.work_history?.length },
    { key: "education", label: "Education", count: doc.education?.length },
    { key: "portfolio", label: "Portfolio plan", count: doc.portfolio_direction?.length },
    { key: "certs", label: "Cert roadmap", count: doc.cert_roadmap?.length },
    { key: "brief", label: "Brief", count: doc.brief?.stack ? 1 : 0 },
  ].filter((t) => t.count);
  const [tab, setTab] = useState(tabs[0]?.key ?? "titles");
  const current = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;
  if (!current) return null;

  return (
    <Panel>
      <PanelHead title={`Version ${versionLabel(version)}`}>
        <StatusBadge tone={isSaved(version) ? "ok" : "warn"}>{isSaved(version) ? "Saved" : "Draft"}</StatusBadge>
      </PanelHead>
      <Tabs value={current} onValueChange={setTab} className="gap-0">
        <div className="overflow-x-auto border-b px-2 py-1.5">
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="px-2 text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="titles" className="divide-y">
          {doc.titles?.map((option, index) => {
            const inUse = option.text.trim() === title.trim();
            return (
              <Row key={option.text} copy={option.text}>
                <p className="font-medium">
                  {option.text}
                  {index === 0 && <span className="text-brand ml-1.5 text-[11px] font-semibold">Top pick</span>}
                </p>
                <p className="text-muted-foreground text-xs">
                  {[option.keyword, option.intent, option.tier_signal].filter(Boolean).join(" · ")}
                </p>
                <Button
                  type="button"
                  size="xs"
                  variant={inUse ? "ghost" : "outline"}
                  disabled={inUse}
                  className="mt-1"
                  onClick={() => onUseTitle(option.text)}
                >
                  {inUse ? <Check /> : <CornerLeftDown />}
                  {inUse ? "In the form" : "Use as title"}
                </Button>
              </Row>
            );
          })}
          {doc.title_rationale && <p className="text-muted-foreground px-3 py-2 text-xs">{doc.title_rationale}</p>}
        </TabsContent>

        <TabsContent value="work" className="divide-y">
          {doc.work_history?.map((entry, index) => (
            <Row key={index} copy={workText(entry)}>
              <p className="font-medium">{[entry.company, entry.location].filter(Boolean).join(" · ")}</p>
              <p className="text-muted-foreground text-xs">
                {[entry.role, entry.duration, entry.employment_type].filter(Boolean).join(" · ")}
              </p>
              <Prose>{entry.story}</Prose>
            </Row>
          ))}
        </TabsContent>

        <TabsContent value="education" className="divide-y">
          {doc.education?.map((entry, index) => (
            <Row key={index} copy={educationText(entry)}>
              <p className="font-medium">{entry.school}</p>
              <p className="text-muted-foreground text-xs">
                {[entry.degree, entry.duration, entry.field].filter(Boolean).join(" · ")}
              </p>
            </Row>
          ))}
        </TabsContent>

        <TabsContent value="portfolio" className="divide-y">
          {doc.portfolio_direction?.map((piece, index) => (
            <Row key={index} copy={[piece.name, piece.doubt, piece.build, piece.signal].join("\n\n")}>
              <p className="font-medium">
                <span className="text-muted-foreground mr-1.5 tabular-nums">{index + 1}</span>
                {piece.name}
              </p>
              <Labelled label="Closes">{piece.doubt}</Labelled>
              <Labelled label="Build">{piece.build}</Labelled>
              <Labelled label="Proves">{piece.signal}</Labelled>
            </Row>
          ))}
        </TabsContent>

        <TabsContent value="certs" className="divide-y">
          {doc.cert_roadmap?.map((step, index) => (
            <Row key={index} copy={`${step.cert} (${step.issuer})`}>
              <p className="font-medium">{step.cert}</p>
              <p className="text-muted-foreground text-xs">{[step.issuer, step.time].filter(Boolean).join(" · ")}</p>
              {step.why && <p className="text-xs">{step.why}</p>}
            </Row>
          ))}
        </TabsContent>

        <TabsContent value="brief">{doc.brief && <Brief brief={doc.brief} />}</TabsContent>
      </Tabs>
    </Panel>
  );
}

function Brief({ brief }: { brief: StackBrief }) {
  const rows: [string, ReactNode][] = [
    ["Stack", brief.stack],
    ["Domain", brief.domain],
    ["Rate tier", brief.rate_tier && `${brief.rate_tier}${brief.posture ? ` — ${brief.posture}` : ""}`],
    ["Verified", brief.certs_verified.join(", ")],
    ["Proxies", brief.cert_proxies.join(", ")],
    ["Tier 1", <Terms key="t1" terms={brief.keywords_t1} strong />],
    ["Tier 2", <Terms key="t2" terms={brief.keywords_t2} />],
    ["Tier 3", <Terms key="t3" terms={brief.keywords_t3} />],
    ["Client fears", <Lines key="f" lines={brief.client_fears} />],
    ["Top 1%", <Lines key="d" lines={brief.differentiators} />],
    ["Tenure rules", <Lines key="r" lines={brief.tenure_rules} />],
    ["Portfolio signal", <Lines key="p" lines={brief.portfolio_signal} />],
  ];
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 text-[13px]">
      {rows
        .filter(([, value]) => (Array.isArray(value) ? value.length : Boolean(value)))
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground pt-px text-xs">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function Terms({ terms, strong }: { terms: string[]; strong?: boolean }) {
  if (!terms.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {terms.map((term) => (
        <span key={term} className={cn("rounded px-1.5 py-px text-xs", strong ? "bg-brand-soft text-brand-ink font-medium" : "bg-muted")}>
          {term}
        </span>
      ))}
    </span>
  );
}

function Lines({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="space-y-0.5">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function Row({ copy, children }: { copy: string; children: ReactNode }) {
  return (
    <div className="group relative space-y-0.5 px-3 py-2.5 pr-10">
      {children}
      <CopyButton text={copy} className="absolute top-2 right-2" />
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-xs">
      <span className="text-muted-foreground mr-1.5 font-medium">{label}</span>
      {children}
    </p>
  );
}

function Prose({ children }: { children: string }) {
  return <p className="pt-1 text-[13px] leading-relaxed whitespace-pre-line">{children}</p>;
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={copied ? "Copied" : "Copy"}
      className={cn("text-muted-foreground transition-transform active:scale-90", copied && "text-success", className)}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

function workText(entry: WorkEntry): string {
  const head = [entry.company, entry.location].filter(Boolean).join(" · ");
  const meta = [entry.role, entry.duration, entry.employment_type].filter(Boolean).join("\n");
  return [head, meta, entry.story].filter(Boolean).join("\n\n");
}

function educationText(entry: EducationEntry): string {
  return [entry.school, entry.degree, entry.duration, entry.field].filter(Boolean).join("\n");
}
