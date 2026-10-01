"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileSignature, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { PhoenixHeroBanner } from "@/components/phoenix-hero-banner";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { request } from "@/lib/api";
import {
  describeEngine,
  formatBudget,
  PROPOSAL_STATUS_LABEL,
  timeAgo,
  type Proposal,
  type ProposalStatus,
} from "@/lib/freelancing";

const FILTERS: ("all" | ProposalStatus)[] = ["all", "draft", "ready", "submitted", "archived"];

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
  const [drafting, setDrafting] = useState(Boolean(searchParams.get("job")));
  const jobId = searchParams.get("job");

  const { data, isLoading } = useQuery({
    queryKey: ["freelancing", "proposals", filter],
    queryFn: () =>
      request<{ items: Proposal[]; total: number }>(
        `/api/v1/freelancing/proposals?limit=300${filter === "all" ? "" : `&status=${filter}`}`,
      ),
  });
  const rows = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PhoenixHeroBanner
        title="Proposals"
        description="Craft, refine, and track AI-tailored proposals that convert. Tailored from your freelancer profile and job requirements."
        actions={
          <Button
            onClick={() => setDrafting(true)}
            className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold text-xs h-10 px-4 shadow-sm"
          >
            <Plus className="size-4 mr-1" />
            New Proposal Draft
          </Button>
        }
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-stone-200 dark:border-stone-800 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() =>
              router.replace(
                f === "all" ? "/freelancing/proposals" : `/freelancing/proposals?status=${f}`,
                { scroll: false },
              )
            }
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold capitalize transition-all ${
              filter === f
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200/80 dark:border-orange-800 shadow-xs"
                : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            }`}
          >
            {f === "all" ? "All Proposals" : PROPOSAL_STATUS_LABEL[f].label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : !rows.length ? (
        <Card className="rounded-2xl border-dashed p-8">
          <EmptyState
            icon={<FileSignature />}
            title={
              filter === "all"
                ? "No proposals yet"
                : `Nothing ${PROPOSAL_STATUS_LABEL[filter as ProposalStatus].label.toLowerCase()}`
            }
            description="Find a high-match opportunity and generate an AI-tailored proposal."
            action={
              <Button
                className="rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold"
                onClick={() => setDrafting(true)}
              >
                Create First Proposal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <Card
              key={p.id}
              className="group relative overflow-hidden rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900/80 hover:border-orange-300 dark:hover:border-orange-900/60 transition-all shadow-xs"
            >
              <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/freelancing/proposals/${p.id}`}
                      className="font-bold text-base text-stone-900 dark:text-stone-100 hover:text-orange-600 transition-colors"
                    >
                      {p.job?.title || "Custom Proposal"}
                    </Link>
                    <StatusBadge
                      tone={p.status === "submitted" ? "ok" : "neutral"}
                      className="text-[10px]"
                    >
                      {PROPOSAL_STATUS_LABEL[p.status]?.label || p.status}
                    </StatusBadge>
                  </div>

                  <p className="text-xs text-stone-500 line-clamp-1">
                    {p.cover_letter_markdown?.slice(0, 140) || "Draft cover letter..."}
                  </p>

                  <div className="flex items-center gap-3 text-[11px] text-stone-400">
                    <span>Updated {timeAgo(p.updated_at)}</span>
                    {p.bid_amount && <span>• Bid: ${p.bid_amount}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <Button
                    asChild
                    size="sm"
                    className="rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:hover:bg-orange-950 dark:text-orange-300 border border-orange-200/80 dark:border-orange-800 text-xs font-semibold gap-1"
                  >
                    <Link href={`/freelancing/proposals/${p.id}`}>
                      Edit Proposal
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewProposalDialog
        open={drafting}
        jobId={jobId}
        onClose={() => {
          setDrafting(false);
          if (jobId) router.replace("/freelancing/proposals", { scroll: false });
        }}
      />
    </div>
  );
}
