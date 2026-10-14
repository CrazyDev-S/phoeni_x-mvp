"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileSignature,
  ListChecks,
  MessageSquare,
  Plug,
  Search,
  Send,
  Star,
  UserRound,
  Lightbulb,
} from "lucide-react";
import Link from "next/link";
import { useState, type ComponentType } from "react";

import { EmptyState } from "@/components/empty-state";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { JobSourceBanner, useJobSource } from "@/components/freelancing/job-source";
import { PageHero } from "@/components/page-hero";
import { SectionHead } from "@/components/section-head";
import { HowItWorks } from "@/components/shared/how-it-works";
import { CheckList, SidePanel } from "@/components/side-panel";
import { StatusBadge } from "@/components/status-badge";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

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
  const stat = (value: number | string) => (summary.isLoading ? "…" : value);

  const focusedItems = focused.data?.items ?? [];
  const highlighted = focusedItems.slice(0, 6).findIndex((j) => j.track_stage === "interviewing");

  return (
    <div className="space-y-7">
      <PageHero
        title="Overview"
        stats={[
          { value: stat(s?.focused ?? 0), label: "Focused" },
          { value: stat(inFlight), label: "In flight" },
          { value: stat(s?.hired ?? 0), label: "Won" },
          { value: stat(winRate === null ? "—" : `${winRate}%`), label: "Win rate" },
        ]}
        actions={
          <>
            <Button variant="secondary" size="lg" onClick={() => setDrafting(true)}>
              <FileSignature />
              Draft a proposal
            </Button>
            <Button asChild variant="brand" size="lg">
              <Link href="/freelancing/jobs">
                <Search />
                Search jobs
              </Link>
            </Button>
          </>
        }
      />

      <JobSourceBanner />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          <section className="space-y-4">
            <SectionHead
              title="Focused postings"
              count={`${focused.data?.total ?? 0} ${focused.data?.total === 1 ? "posting" : "postings"}`}
            >
              <Button asChild variant="outline" size="xs">
                <Link href="/freelancing/jobs?tab=focused">
                  View all
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </SectionHead>

            {focused.isLoading ? (
              <div className="space-y-2.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[4.5rem] w-full rounded-[22px]" />
                ))}
              </div>
            ) : !focusedItems.length ? (
              <Card tone="soft" className="gap-0 py-0">
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
              </Card>
            ) : (
              <ul className="space-y-2.5">
                {focusedItems.slice(0, 6).map((job, index) => (
                  <FocusedRow key={job.id} job={job} highlight={index === highlighted} />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-4">
            <SectionHead
              title="Recent proposals"
              count={`${proposals.data?.total ?? 0} ${proposals.data?.total === 1 ? "proposal" : "proposals"}`}
            >
              <Button asChild variant="outline" size="xs">
                <Link href="/freelancing/proposals">
                  View all
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </SectionHead>

            <Card className="gap-0 py-1.5">
              <CardContent>
                {proposals.isLoading ? (
                  <div className="space-y-3 py-4">
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
                  <ul className="divide-border divide-y">
                    {proposals.data.items.map((p) => (
                      <li key={p.id} className="relative flex items-center gap-3.5 py-3.5">
                        <Tile icon={FileSignature} />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/freelancing/proposals/${p.id}`}
                            className="line-clamp-2 font-semibold after:absolute after:inset-0 sm:block sm:truncate"
                          >
                            {p.job?.title ?? "Proposal"}
                          </Link>
                          <p className="text-muted-foreground truncate text-sm font-medium">
                            {describeEngine(p.engine_version)}
                          </p>
                        </div>
                        <StatusBadge tone={PROPOSAL_STATUS_LABEL[p.status].tone} className="shrink-0">
                          {PROPOSAL_STATUS_LABEL[p.status].label}
                        </StatusBadge>
                        <span className="text-muted-foreground hidden w-16 shrink-0 text-right text-sm font-medium tabular-nums sm:block">
                          {timeAgo(p.updated_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        <aside className="space-y-5">
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
          <HowItWorks
            title="How Freelancing works"
            steps={[
              { title: "Search and focus", detail: "Every filter the source offers, then a star on the postings worth a bid." },
              { title: "Draft the proposal", detail: "A scaffold from your profile and the posting. Rewrite, set the bid, send it." },
              { title: "Track it to hired", detail: "Submitted, viewed, interviewing, won - with calls on the shared calendar." },
            ]}
          />
        </aside>
      </div>

      <NewProposalDialog open={drafting} onClose={() => setDrafting(false)} />
    </div>
  );
}

function FocusedRow({ job, highlight }: { job: JobCard; highlight: boolean }) {
  const stage = job.track_stage;
  const tone = stage ? STAGE_TONE[stage] : null;
  const meta = [
    formatBudget(job),
    job.client.country,
    job.total_applicants != null ? `${job.total_applicants} proposals` : null,
  ].filter(Boolean) as string[];

  return (
    <li
      className={cn(
        "relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] px-[22px] py-3.5",
        highlight ? "bg-brand text-brand-foreground" : "bg-card shadow-card",
      )}
    >
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <Link
          href={`/freelancing/jobs/${job.id}`}
          className="line-clamp-2 text-base sm:block sm:truncate font-semibold tracking-tight after:absolute after:inset-0"
        >
          {job.title}
        </Link>
        <p
          className={cn(
            "mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm font-medium",
            highlight ? "text-brand-foreground/65" : "text-muted-foreground",
          )}
        >
          {meta.map((part, i) => (
            <span key={part} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-current opacity-50" />}
              <span className={cn(i === 0 && (highlight ? "text-brand-foreground font-semibold" : "text-foreground font-semibold"))}>
                {part}
              </span>
            </span>
          ))}
        </p>
      </div>
      {stage &&
        (highlight ? (
          <Badge className="shrink-0">{STAGE_LABEL[stage]}</Badge>
        ) : tone === "brand" ? (
          <Badge variant="secondary" className="bg-brand-soft text-brand-ink shrink-0">
            {STAGE_LABEL[stage]}
          </Badge>
        ) : (
          <StatusBadge tone={tone ?? "neutral"} className="shrink-0">
            {STAGE_LABEL[stage]}
          </StatusBadge>
        ))}
      <span
        className={cn(
          "hidden w-16 shrink-0 text-right text-sm font-medium tabular-nums sm:block",
          highlight ? "text-brand-foreground/65" : "text-muted-foreground",
        )}
      >
        {timeAgo(job.published_at)}
      </span>
      <span
        aria-hidden
        className={cn(
          "hidden size-10 shrink-0 place-items-center rounded-full sm:grid",
          highlight ? "bg-black/10" : "bg-soft-2",
        )}
      >
        <ArrowUpRight className="size-[18px]" />
      </span>
    </li>
  );
}

interface RecommendedAction {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  done: boolean;
  href?: string;
  onClick?: () => void;
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
  const actions: RecommendedAction[] = [
    { href: "/settings?tab=integrations", Icon: Plug, title: "Set up job search", detail: `Connect ${sourceLabel} under Integrations.`, done: connected },
    { href: "/freelancing/profile", Icon: UserRound, title: "Write your profile", detail: "Title, overview, rate, skills, evidence.", done: hasProfile },
    { href: "/freelancing/jobs", Icon: Star, title: "Focus a posting", detail: "Search, then star the ones worth a bid.", done: hasFocused },
    { onClick: onDraft, Icon: FileSignature, title: "Draft a proposal", detail: "From the profile and the posting.", done: hasProposal },
    { href: "/freelancing/tracking", Icon: Send, title: "Submit and track it", detail: "Stages, calls and the outcome in one place.", done: hasSubmitted },
  ];
  const left = actions.filter((a) => !a.done).length;
  const first = actions.findIndex((a) => !a.done);

  return (
    <Card tone="dark" className="gap-0 rounded-[2.25rem] px-6 pt-6 pb-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-panel-raised grid size-10 shrink-0 place-items-center rounded-full">
            <ListChecks className="size-[18px]" />
          </span>
          <h2 className="text-2xl font-medium tracking-tight">Recommended</h2>
        </div>
        <span className="text-panel-muted border-panel-muted border-b-[1.5px] pb-px text-[13px] font-semibold">
          {left} left
        </span>
      </div>
      <ul>
        {actions.map(({ Icon, title, detail, done, href, onClick }, index) => {
          const lead = index === first;
          const text = cn(
            "text-left text-base font-semibold after:absolute after:inset-0",
            done && "text-panel-muted",
          );
          return (
            <li key={title} className="border-panel-raised relative flex items-start gap-3.5 border-t py-4 first:border-t-0">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl",
                  done ? "bg-panel-raised text-brand" : lead ? "bg-brand text-brand-foreground" : "bg-panel-raised text-panel-foreground",
                )}
              >
                {done ? <Check className="size-4 stroke-[2.5]" /> : <Icon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                {href ? (
                  <Link href={href} className={text}>
                    {title}
                    {done && <span className="sr-only"> (done)</span>}
                  </Link>
                ) : (
                  <button type="button" onClick={onClick} className={text}>
                    {title}
                    {done && <span className="sr-only"> (done)</span>}
                  </button>
                )}
                <p className="text-panel-muted mt-0.5 text-[0.8125rem] leading-snug">{detail}</p>
              </div>
              {!done && (
                <span
                  aria-hidden
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full",
                    lead ? "bg-brand text-brand-foreground" : "bg-panel-raised text-panel-muted",
                  )}
                >
                  <ArrowRight className="size-4" />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
