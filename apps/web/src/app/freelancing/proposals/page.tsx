"use client";

import { useQuery } from "@tanstack/react-query";
import { Archive, ArrowRight, FileCheck2, FilePenLine, FileSignature, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ComponentType } from "react";

import { EmptyState } from "@/components/empty-state";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { PageHero } from "@/components/page-hero";
import { SectionHead } from "@/components/section-head";
import { StatusBadge } from "@/components/status-badge";
import { Tile } from "@/components/tile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, ChipCount, ChipRow } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { request } from "@/lib/api";
import {
  formatBudget,
  PROPOSAL_STATUS_LABEL,
  timeAgo,
  type JobCard,
  type Proposal,
  type ProposalStatus,
} from "@/lib/freelancing";
import { cn } from "@/lib/utils";

const FILTERS: ("all" | ProposalStatus)[] = ["all", "draft", "ready", "submitted", "archived"];

const STATUS_ICON: Record<ProposalStatus, ComponentType<{ className?: string }>> = {
  draft: FilePenLine,
  ready: FileCheck2,
  submitted: Send,
  archived: Archive,
};

function money(amount: number, currency: string | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: amount % 1 ? 2 : 0,
  }).format(amount);
}

/** "$2,800" over "Fixed · 16 connects", from whatever the bid has so far. */
function bidLines(p: Proposal): { main: string; sub: string } {
  const main =
    p.bid_amount == null
      ? "Not set"
      : p.bid_type === "hourly"
        ? `${money(p.bid_amount, p.bid_currency)}/hr`
        : money(p.bid_amount, p.bid_currency);
  const sub = [
    p.bid_type === "hourly" ? "Hourly" : p.bid_type === "fixed" ? "Fixed" : null,
    p.connects_estimate != null ? `${p.connects_estimate} connects` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { main, sub };
}

const ROW_GRID =
  "grid grid-cols-[2.75rem_minmax(0,1fr)_2.25rem] items-center gap-x-4 gap-y-2 lg:grid-cols-[48px_minmax(0,1fr)_112px_128px_64px_36px]";

export default function ProposalsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ProposalsList />
    </Suspense>
  );
}

function ProposalsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("status");
  const filter = (FILTERS as string[]).includes(requested ?? "")
    ? (requested as (typeof FILTERS)[number])
    : "all";
  const paramJob = searchParams.get("job");
  const [drafting, setDrafting] = useState(Boolean(paramJob));
  const [draftJob, setDraftJob] = useState<string | null>(paramJob);

  const { data, isLoading } = useQuery({
    queryKey: ["freelancing", "proposals", filter],
    queryFn: () =>
      request<{ items: Proposal[]; total: number }>(
        `/api/v1/freelancing/proposals?limit=300${filter === "all" ? "" : `&status=${filter}`}`,
      ),
  });
  const rows = data?.items ?? [];

  // Shares its cache entry with the unfiltered list, so the counts cost nothing extra on "All".
  const everything = useQuery({
    queryKey: ["freelancing", "proposals", "all"],
    queryFn: () =>
      request<{ items: Proposal[]; total: number }>("/api/v1/freelancing/proposals?limit=300"),
  });
  const counts = { all: 0, draft: 0, ready: 0, submitted: 0, archived: 0 };
  for (const p of everything.data?.items ?? []) {
    counts.all += 1;
    counts[p.status] += 1;
  }

  const focused = useQuery({
    queryKey: ["freelancing", "jobs", "focused"],
    queryFn: () => request<{ items: JobCard[] }>("/api/v1/freelancing/jobs?focused=true&limit=200"),
  });
  const undrafted = (focused.data?.items ?? []).filter((j) => j.proposal_count === 0);

  const draftFrom = (jobId: string | null) => {
    setDraftJob(jobId);
    setDrafting(true);
  };

  return (
    <div className="space-y-7">
      <PageHero
        title="Proposals"
        stats={
          everything.data
            ? [
                { value: counts.all, label: "Total" },
                { value: counts.ready, label: "Ready to send" },
                { value: counts.submitted, label: "Submitted" },
              ]
            : undefined
        }
        actions={
          <Button variant="brand" size="lg" onClick={() => draftFrom(null)}>
            <Plus />
            New proposal
          </Button>
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <ChipRow>
              {FILTERS.map((f) => (
                <Chip
                  key={f}
                  active={filter === f}
                  onClick={() =>
                    router.replace(
                      f === "all" ? "/freelancing/proposals" : `/freelancing/proposals?status=${f}`,
                      { scroll: false },
                    )
                  }
                >
                  {f === "all" ? "All" : PROPOSAL_STATUS_LABEL[f].label}
                  {everything.data && <ChipCount>{counts[f]}</ChipCount>}
                </Chip>
              ))}
            </ChipRow>
            <span className="text-muted-foreground text-[13px] font-medium lg:ml-auto">
              Most recently updated first
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-[26px]" />
              ))}
            </div>
          ) : !rows.length ? (
            <Card className="border-border border-[1.5px] border-dashed bg-transparent p-8 shadow-none">
              <EmptyState
                icon={<FileSignature />}
                title={
                  filter === "all"
                    ? "No proposals yet"
                    : `Nothing ${PROPOSAL_STATUS_LABEL[filter as ProposalStatus].label.toLowerCase()}`
                }
                description="Focus a posting, then draft a proposal from your profile."
                action={<Button variant="brand" onClick={() => draftFrom(null)}>Create a proposal</Button>}
              />
            </Card>
          ) : (
            <div>
              <div
                aria-hidden
                className={cn(
                  ROW_GRID,
                  "text-subtle hidden px-[18px] pb-2.5 text-[12.5px] font-semibold tracking-[0.06em] uppercase lg:grid",
                )}
              >
                <span />
                <span>Posting</span>
                <span>Status</span>
                <span>Bid</span>
                <span>Updated</span>
                <span />
              </div>
              <ul className="space-y-2.5">
                {rows.map((p) => {
                  const bid = bidLines(p);
                  const ready = p.status === "ready";
                  const Icon = STATUS_ICON[p.status] ?? FilePenLine;
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        ROW_GRID,
                        "group relative rounded-[26px] py-4 pr-5.5 pl-[18px] transition-shadow",
                        ready ? "bg-brand text-brand-foreground" : "bg-card shadow-card hover:shadow-md",
                        p.status === "archived" && "opacity-80",
                      )}
                    >
                      <Tile
                        icon={Icon}
                        tone={ready ? "ink" : p.status === "archived" ? "neutral" : "soft"}
                        className="size-12 rounded-[14px]"
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/freelancing/proposals/${p.id}`}
                          className="focus-visible:after:ring-ring/50 block truncate text-[16.5px] font-semibold tracking-tight outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3"
                        >
                          {p.job?.title || "Custom proposal"}
                        </Link>
                        <p
                          className={cn(
                            "mt-1 truncate text-[13.5px]",
                            ready ? "text-brand-foreground/65" : "text-muted-foreground",
                          )}
                        >
                          {p.cover_letter_markdown?.replace(/\s+/g, " ").slice(0, 200) || "No letter written yet"}
                        </p>
                      </div>
                      <div className="col-start-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 lg:contents">
                        <div>
                          <StatusBadge
                            tone={p.status === "submitted" ? "ok" : "neutral"}
                            className={cn(ready && "bg-panel text-panel-foreground")}
                          >
                            {PROPOSAL_STATUS_LABEL[p.status]?.label || p.status}
                          </StatusBadge>
                        </div>
                        <div className="text-[17px] font-semibold tabular-nums">
                          {bid.main}
                          {bid.sub && (
                            <small
                              className={cn(
                                "mt-0.5 block text-[12.5px] font-medium",
                                ready ? "text-brand-foreground/65" : "text-muted-foreground",
                              )}
                            >
                              {bid.sub}
                            </small>
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[13.5px] font-medium",
                            ready ? "text-brand-foreground/65" : "text-muted-foreground",
                          )}
                        >
                          {timeAgo(p.updated_at)}
                        </span>
                      </div>
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-9 place-items-center justify-self-end rounded-full max-lg:col-start-3 max-lg:row-start-1",
                          ready ? "bg-card text-foreground" : "bg-primary text-primary-foreground",
                        )}
                      >
                        <ArrowRight className="size-4" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {undrafted.length > 0 && (
          <aside>
            <Card className="gap-0 p-6">
              <SectionHead title="Focused, no draft yet" count={`${undrafted.length} ${undrafted.length === 1 ? "posting" : "postings"}`} className="[&_h2]:text-xl" />
              <ul className="divide-border mt-2 divide-y">
                {undrafted.slice(0, 6).map((j) => (
                  <li key={j.id} className="flex items-center gap-3.5 py-3.5 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{j.title}</p>
                      <p className="text-muted-foreground truncate text-[13px] font-medium">
                        {[formatBudget(j), j.client.country].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => draftFrom(j.id)}>
                      Draft
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        )}
      </div>

      <NewProposalDialog
        open={drafting}
        jobId={draftJob}
        onClose={() => {
          setDrafting(false);
          setDraftJob(null);
          if (paramJob) router.replace("/freelancing/proposals", { scroll: false });
        }}
      />
    </div>
  );
}
