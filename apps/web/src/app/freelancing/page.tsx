"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  FileSignature,
  KanbanSquare,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Plug,
  Search,
  Send,
  Star,
  Trophy,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { JobSourceBanner, useJobSource } from "@/components/freelancing/job-source";
import { PageHero } from "@/components/page-hero";
import { NextCallBanner } from "@/components/shared/next-call";
import { CheckList, SidePanel } from "@/components/side-panel";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { StepsBand } from "@/components/steps-band";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { request } from "@/lib/api";
import {
  describeEngine,
  formatBudget,
  PROPOSAL_STATUS_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  timeAgo,
  type FreelancerProfile,
  type JobCard,
  type Proposal,
  type TrackSummary,
} from "@/lib/freelancing";

const TIPS = [
  "Focus only the postings you would actually bid on; the tracker starts there.",
  "Verified payment and real hires say more than the budget line.",
  "Drafts are scaffolds. Rewrite the first two sentences before anything else.",
  "Mark a proposal submitted the moment it goes out, so connects are counted.",
];

export default function FreelancingOverviewPage() {
  const [drafting, setDrafting] = useState(false);
  const source = useJobSource();
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
    queryFn: () => request<{ items: Proposal[]; total: number }>("/api/v1/freelancing/proposals?limit=6"),
  });
  const profiles = useQuery({
    queryKey: ["freelancing", "profiles"],
    queryFn: () => request<FreelancerProfile[]>("/api/v1/freelancing/profiles"),
  });

  const s = summary.data;
  const inFlight = s ? s.submitted + s.viewed + s.interviewing : 0;
  const decided = s ? s.hired + s.declined : 0;
  const winRate = s && decided ? Math.round((s.hired / decided) * 100) : null;

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Freelancing"
        eyebrowIcon={Search}
        title={
          <>
            Win the next <span className="text-gradient-brand">contract</span>
          </>
        }
        description="Search Upwork jobs with every filter the source offers, focus the postings worth your connects, and run each bid from draft to hired."
        actions={
          <>
            <Button asChild variant="brand" size="lg" className="h-11">
              <Link href="/freelancing/jobs">
                <Search />
                Search jobs
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-11" onClick={() => setDrafting(true)}>
              <FileSignature />
              Draft a proposal
            </Button>
          </>
        }
      />

      <JobSourceBanner />
      <NextCallBanner />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Focused" Icon={Star} loading={summary.isLoading} value={s?.focused ?? 0} hint="Postings in the tracker, not yet sent" />
        <StatCard label="In flight" Icon={Send} tone="info" loading={summary.isLoading} value={inFlight} hint="Submitted, viewed or interviewing" />
        <StatCard label="Won" Icon={Trophy} tone="success" loading={summary.isLoading} value={s?.hired ?? 0} hint="Hired from a bid here" />
        <StatCard
          label="Win rate"
          Icon={KanbanSquare}
          tone="warning"
          loading={summary.isLoading}
          value={winRate === null ? "—" : `${winRate}%`}
          hint={decided ? `${s!.hired} of ${decided} decided bids` : "No decided bids yet"}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between border-b py-4">
              <CardTitle className="text-base">Focused postings</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/freelancing/jobs?tab=focused">
                  View all
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {focused.isLoading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !focused.data?.items.length ? (
                <EmptyState
                  icon={<Star />}
                  title="Nothing focused yet"
                  description="Star a posting in the search results and it lands here, at the first stage of the tracker."
                  action={
                    <Button asChild>
                      <Link href="/freelancing/jobs">Search jobs</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {focused.data.items.slice(0, 6).map((job) => (
                    <li key={job.id} className="hover:bg-muted/40 relative transition-colors">
                      <div className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/freelancing/jobs/${job.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">
                            {job.title}
                          </Link>
                          <p className="text-muted-foreground truncate text-xs">
                            {formatBudget(job)}
                            {job.client.country ? ` · ${job.client.country}` : ""}
                            {job.total_applicants != null ? ` · ${job.total_applicants} proposals` : ""}
                          </p>
                        </div>
                        {job.track_stage && (
                          <StatusBadge tone={STAGE_TONE[job.track_stage]} className="relative z-10 shrink-0">
                            {STAGE_LABEL[job.track_stage]}
                          </StatusBadge>
                        )}
                        <span className="text-subtle hidden shrink-0 text-xs tabular-nums sm:block">
                          {timeAgo(job.published_at)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between border-b py-4">
              <CardTitle className="text-base">Recent proposals</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/freelancing/proposals">
                  View all
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {proposals.isLoading ? (
                <div className="space-y-3 p-5">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !proposals.data?.items.length ? (
                <EmptyState
                  icon={<MessageSquare />}
                  title="No proposals yet"
                  description="Draft one from a focused posting; the template engine gives you a scaffold to rewrite."
                  action={<Button onClick={() => setDrafting(true)}>Draft a proposal</Button>}
                />
              ) : (
                <ul className="divide-y">
                  {proposals.data.items.map((p) => (
                    <li key={p.id} className="hover:bg-muted/40 relative transition-colors">
                      <div className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/freelancing/proposals/${p.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">
                            {p.job?.title ?? "Proposal"}
                          </Link>
                          <p className="text-muted-foreground truncate text-xs">{describeEngine(p.engine_version)}</p>
                        </div>
                        <StatusBadge tone={PROPOSAL_STATUS_LABEL[p.status].tone} className="relative z-10 shrink-0">
                          {PROPOSAL_STATUS_LABEL[p.status].label}
                        </StatusBadge>
                        <span className="text-subtle hidden shrink-0 text-xs tabular-nums sm:block">{timeAgo(p.updated_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <StepsBand
            title="How Freelancing works"
            description="Three steps, from a search to a signed contract."
            steps={[
              { title: "Search and focus", detail: "Every filter the source offers, then a star on the postings worth a bid." },
              { title: "Draft the proposal", detail: "A scaffold from your profile and the posting. Rewrite, set the bid, send it." },
              { title: "Track it to hired", detail: "Submitted, viewed, interviewing, won - with calls on the shared calendar." },
            ]}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <Recommended
            sourceLabel={source.data?.label ?? "the job source"}
            connected={Boolean(source.data?.ready)}
            hasProfile={Boolean(profiles.data?.length)}
            hasFocused={Boolean(focused.data?.items.length)}
            hasProposal={Boolean(proposals.data?.items.length)}
            hasSubmitted={Boolean(s && s.submitted + s.viewed + s.interviewing + s.hired > 0)}
            onDraft={() => setDrafting(true)}
          />
          <SidePanel icon={Lightbulb} title="Bid better">
            <CheckList items={TIPS} />
          </SidePanel>
        </aside>
      </div>

      <NewProposalDialog open={drafting} onClose={() => setDrafting(false)} />
    </div>
  );
}

function Recommended({
  sourceLabel,
  connected,
  hasProfile,
  hasFocused,
  hasProposal,
  hasSubmitted,
  onDraft,
}: {
  sourceLabel: string;
  connected: boolean;
  hasProfile: boolean;
  hasFocused: boolean;
  hasProposal: boolean;
  hasSubmitted: boolean;
  onDraft: () => void;
}) {
  const actions = [
    { href: "/settings?tab=integrations", Icon: Plug, title: "Set up job search", detail: `Connect ${sourceLabel} under Integrations.`, done: connected },
    { href: "/freelancing/profile", Icon: UserRound, title: "Write your profile", detail: "Title, overview, rate, skills, evidence.", done: hasProfile },
    { href: "/freelancing/jobs", Icon: Star, title: "Focus a posting", detail: "Search, then star the ones worth a bid.", done: hasFocused },
    { onClick: onDraft, Icon: FileSignature, title: "Draft a proposal", detail: "From the profile and the posting.", done: hasProposal },
    { href: "/freelancing/tracking", Icon: Send, title: "Submit and track it", detail: "Stages, calls and the outcome in one place.", done: hasSubmitted },
  ];
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-center gap-2.5 space-y-0 border-b py-4">
        <span className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <ListChecks className="size-4" />
        </span>
        <CardTitle className="text-base">Recommended actions</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y">
          {actions.map(({ Icon, title, detail, done, ...target }) => (
            <li key={title} className="hover:bg-muted/40 relative transition-colors">
              <div className="flex items-start gap-3 px-5 py-3.5">
                <span className={done ? "bg-success/10 text-success flex size-8 shrink-0 items-center justify-center rounded-lg" : "bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"}>
                  {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  {"href" in target ? (
                    <Link href={target.href!} className="text-sm font-medium after:absolute after:inset-0">
                      {title}
                    </Link>
                  ) : (
                    <button type="button" onClick={target.onClick} className="text-left text-sm font-medium after:absolute after:inset-0">
                      {title}
                    </button>
                  )}
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{detail}</p>
                </div>
                <ArrowRight className="text-subtle mt-1 size-4 shrink-0" />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
