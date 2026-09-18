import { Download, Globe, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { hostOf } from "@/lib/page";
import { cn } from "@/lib/utils";
import { EmptyNote } from "../../chrome-shell";
import { Progress } from "../../components";
import type { JobRow } from "./use-job-board";

/** Every web page open in the window, each with its posting's resume or run. */
export function JobTabList({
  rows,
  selected,
  canTailor,
  onSelect,
  onTailor,
  onDownload,
  onFocus,
}: {
  rows: JobRow[];
  selected: Set<number>;
  canTailor: boolean;
  onSelect: (tabId: number, on: boolean) => void;
  onTailor: (row: JobRow) => void;
  onDownload: (row: JobRow) => void;
  onFocus: (row: JobRow) => void;
}) {
  if (!rows.length) {
    return (
      <EmptyNote icon={Globe}>
        Open the job postings you want in this window, and they show up here.
      </EmptyNote>
    );
  }

  return (
    <ul className="bg-card divide-y rounded-xl border">
      {rows.map((row) => {
        const { tab, link, run } = row;
        const running = Boolean(run?.running);
        const title =
          (link?.job_title && link.company_name
            ? `${link.job_title} · ${link.company_name}`
            : tab.title) || hostOf(tab.url);
        return (
          <li
            key={tab.tabId}
            className={cn("flex items-start gap-2 px-2.5 py-2", tab.active && "bg-accent/40")}
          >
            <Checkbox
              checked={selected.has(tab.tabId)}
              onCheckedChange={(on) => onSelect(tab.tabId, on === true)}
              aria-label={`Select ${title}`}
              className="mt-0.5"
            />
            <TabIcon url={tab.favIconUrl} />
            <div className="min-w-0 flex-1 space-y-1">
              <button
                type="button"
                onClick={() => onFocus(row)}
                title={`Go to ${tab.title || tab.url}`}
                className="block w-full truncate text-left text-xs font-medium hover:underline"
              >
                {title}
              </button>
              <RowStatus row={row} />
            </div>
            <div className="flex shrink-0 items-center">
              {link?.resume && !running && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Download the resume for ${title}`}
                  title="Download .docx"
                  onClick={() => onDownload(row)}
                >
                  <Download />
                </Button>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Tailor a resume for ${title}`}
                title="Tailor & download"
                disabled={!canTailor || running}
                onClick={() => onTailor(row)}
              >
                {running ? <Spinner /> : <Sparkles />}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RowStatus({ row }: { row: JobRow }) {
  const { tab, link, run } = row;
  if (run?.running) return <Progress label={run.label} percent={run.percent} />;
  if (run?.error) {
    return <p className="text-destructive line-clamp-2 text-[10px] leading-snug">{run.error}</p>;
  }
  if (link?.resume) {
    const tailored = link.resume.kind === "tailored";
    const coverage = link.resume.must_have_coverage_percent;
    return (
      <p className="text-muted-foreground truncate text-[10px]" title={link.resume.display_name}>
        <span className={cn("font-medium", tailored && "text-success")}>
          {tailored ? "Tailored" : "Linked"}
        </span>
        {coverage !== null && ` · ${Math.round(coverage)}%`} · {link.resume.display_name}
      </p>
    );
  }
  if (link?.generation?.status === "failed") {
    return (
      <p className="text-destructive line-clamp-2 text-[10px] leading-snug">
        Last run failed: {link.generation.error_detail ?? "unknown error"}
      </p>
    );
  }
  return (
    <p className="text-subtle truncate text-[10px]">
      {hostOf(tab.url)}
      {link && " · no resume yet"}
    </p>
  );
}

function TabIcon({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken || !/^(https?|data):/.test(url)) {
    return <Globe className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />;
  }
  return (
    <img
      src={url}
      alt=""
      className="mt-0.5 size-3.5 shrink-0 rounded-sm"
      onError={() => setBroken(true)}
    />
  );
}
