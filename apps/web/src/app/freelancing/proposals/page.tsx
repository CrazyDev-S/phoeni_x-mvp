"use client";

import { useQuery } from "@tanstack/react-query";
import { FileSignature, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { PageHero } from "@/components/page-hero";
import { Panel, PanelHead } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Chip, ChipCount, ChipRow } from "@/components/ui/chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const FILTERS: ("all" | ProposalStatus)[] = ["all", "draft", "ready", "submitted", "archived"];

function money(amount: number, currency: string | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: amount % 1 ? 2 : 0,
  }).format(amount);
}

/** "$2,800 · Fixed · 16 connects", from whatever the bid has so far. */
function bidText(p: Proposal): string {
  if (p.bid_amount == null) return "-";
  const amount =
    p.bid_type === "hourly" ? `${money(p.bid_amount, p.bid_currency)}/hr` : money(p.bid_amount, p.bid_currency);
  return [amount, p.connects_estimate != null ? `${p.connects_estimate} connects` : null].filter(Boolean).join(" · ");
}

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
    <div className="space-y-3">
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
          <Button variant="brand" onClick={() => draftFrom(null)}>
            <Plus />
            New proposal
          </Button>
        }
      />

      <ChipRow>
        {FILTERS.map((f) => (
          <Chip
            key={f}
            active={filter === f}
            onClick={() =>
              router.replace(f === "all" ? "/freelancing/proposals" : `/freelancing/proposals?status=${f}`, {
                scroll: false,
              })
            }
          >
            {f === "all" ? "All" : PROPOSAL_STATUS_LABEL[f].label}
            {everything.data && <ChipCount>{counts[f]}</ChipCount>}
          </Chip>
        ))}
      </ChipRow>

      {isLoading ? (
        <Panel className="divide-y">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex h-9 items-center px-3">
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ))}
        </Panel>
      ) : !rows.length ? (
        <Panel>
          <EmptyState
            icon={<FileSignature />}
            title={
              filter === "all"
                ? "No proposals yet"
                : `Nothing ${PROPOSAL_STATUS_LABEL[filter as ProposalStatus].label.toLowerCase()}`
            }
            action={
              <Button variant="brand" size="sm" onClick={() => draftFrom(null)}>
                Create a proposal
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Posting</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Bid</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow
                  key={p.id}
                  className={p.status === "archived" ? "opacity-70" : undefined}
                  onClick={() => router.push(`/freelancing/proposals/${p.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <TableCell className="w-full max-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/freelancing/proposals/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="min-w-0 shrink-[3] truncate font-medium hover:underline"
                      >
                        {p.job?.title || "Custom proposal"}
                      </Link>
                      <span className="text-muted-foreground hidden min-w-0 flex-1 truncate text-xs xl:inline">
                        {p.cover_letter_markdown?.replace(/\s+/g, " ").slice(0, 160) || "No letter written yet"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={p.status === "submitted" ? "ok" : p.status === "ready" ? "brand" : "neutral"}>
                      {PROPOSAL_STATUS_LABEL[p.status]?.label || p.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{bidText(p)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{timeAgo(p.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      {undrafted.length > 0 && (
        <Panel>
          <PanelHead title="Focused, no draft yet" count={undrafted.length} />
          <Table>
            <TableBody>
              {undrafted.slice(0, 10).map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="w-full max-w-0">
                    <span className="block truncate font-medium">{j.title}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {[formatBudget(j), j.client.country].filter(Boolean).join(" · ")}
                  </TableCell>
                  <TableCell className="w-16 text-right">
                    <Button variant="outline" size="xs" onClick={() => draftFrom(j.id)}>
                      Draft
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

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
