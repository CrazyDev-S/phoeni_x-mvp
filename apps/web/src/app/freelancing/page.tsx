"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileSignature, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { JobSourceBanner } from "@/components/freelancing/job-source";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { PageHero } from "@/components/page-hero";
import { Panel, PanelHead } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { request } from "@/lib/api";
import {
  formatBudget,
  PROPOSAL_STATUS_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  timeAgo,
  type JobCard,
  type Proposal,
  type TrackSummary,
} from "@/lib/freelancing";

export default function FreelancingOverviewPage() {
  const [drafting, setDrafting] = useState(false);
  const summary = useQuery({
    queryKey: ["freelancing", "tracks", "summary"],
    queryFn: () => request<TrackSummary>("/api/v1/freelancing/tracks/summary"),
  });
  const focused = useQuery({
    queryKey: ["freelancing", "jobs", "focused"],
    queryFn: () => request<{ items: JobCard[]; total: number }>("/api/v1/freelancing/jobs?focused=true&limit=200"),
  });
  const proposals = useQuery({
    queryKey: ["freelancing", "proposals", "recent"],
    queryFn: () => request<{ items: Proposal[]; total: number }>("/api/v1/freelancing/proposals?limit=12"),
  });

  const s = summary.data;
  const inFlight = s ? s.submitted + s.viewed + s.interviewing : 0;
  const decided = s ? s.hired + s.declined : 0;
  const winRate = s && decided ? Math.round((s.hired / decided) * 100) : null;

  return (
    <div className="space-y-3">
      <PageHero
        title="Overview"
        stats={
          s
            ? [
                { value: s.focused, label: "Focused" },
                { value: inFlight, label: "In flight" },
                { value: s.hired, label: "Won" },
                { value: winRate === null ? "-" : `${winRate}%`, label: "Win rate" },
              ]
            : undefined
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setDrafting(true)}>
              <FileSignature />
              Draft a proposal
            </Button>
            <Button asChild variant="brand">
              <Link href="/freelancing/jobs">
                <Search />
                Search jobs
              </Link>
            </Button>
          </>
        }
      />

      <JobSourceBanner />

      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <Panel>
          <PanelHead title="Focused postings" count={focused.data?.total ?? 0}>
            <Button asChild variant="ghost" size="xs">
              <Link href="/freelancing/jobs?tab=focused">
                View all
                <ArrowRight />
              </Link>
            </Button>
          </PanelHead>
          {focused.isLoading ? (
            <RowSkeleton />
          ) : !focused.data?.items.length ? (
            <EmptyState title="Nothing focused yet. Star a posting in Jobs." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Job</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {focused.data.items.slice(0, 12).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="w-full max-w-0">
                      <Link href={`/freelancing/jobs/${job.id}`} className="block truncate font-medium hover:underline" title={job.title}>
                        {job.title}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{formatBudget(job)}</TableCell>
                    <TableCell>
                      {job.track_stage && (
                        <StatusBadge tone={STAGE_TONE[job.track_stage]}>{STAGE_LABEL[job.track_stage]}</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{timeAgo(job.published_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <Panel>
          <PanelHead title="Recent proposals" count={proposals.data?.total ?? 0}>
            <Button asChild variant="ghost" size="xs">
              <Link href="/freelancing/proposals">
                View all
                <ArrowRight />
              </Link>
            </Button>
          </PanelHead>
          {proposals.isLoading ? (
            <RowSkeleton />
          ) : !proposals.data?.items.length ? (
            <EmptyState
              title="No proposals yet."
              action={
                <Button size="sm" onClick={() => setDrafting(true)}>
                  Draft a proposal
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Proposal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="w-full max-w-0">
                      <Link href={`/freelancing/proposals/${p.id}`} className="block truncate font-medium hover:underline">
                        {p.job?.title ?? "Proposal"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={PROPOSAL_STATUS_LABEL[p.status].tone}>
                        {PROPOSAL_STATUS_LABEL[p.status].label}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{timeAgo(p.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <NewProposalDialog open={drafting} onClose={() => setDrafting(false)} />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="divide-y">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-9 items-center px-3">
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ))}
    </div>
  );
}
