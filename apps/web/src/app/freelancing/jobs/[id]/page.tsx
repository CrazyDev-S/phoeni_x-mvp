"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  ExternalLink,
  EyeOff,
  FileSignature,
  KanbanSquare,
  Paperclip,
  RefreshCw,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { FocusButton, JobMetaChips } from "@/components/freelancing/job-card";
import { useJobSource } from "@/components/freelancing/job-source";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { PageHero } from "@/components/page-hero";
import { FactList, SidePanel } from "@/components/side-panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { request } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  describeEngine,
  humanizeEnum,
  invalidateFreelancing,
  PROPOSAL_STATUS_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  timeAgo,
  type JobCard,
  type JobDetail,
  type Proposal,
} from "@/lib/freelancing";

function money(value: number | null | undefined): string {
  return value == null ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [drafting, setDrafting] = useState(false);
  const key = ["freelancing", "job", id];
  const source = useJobSource();
  // A source whose search results are already complete (Apify) has nothing more to fetch.
  const canRefresh = source.data?.detail ?? false;

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => request<JobDetail>(`/api/v1/freelancing/jobs/${id}`),
  });
  const proposals = useQuery({
    queryKey: ["freelancing", "proposals", "job", id],
    queryFn: () => request<{ items: Proposal[] }>(`/api/v1/freelancing/proposals?job_id=${id}`),
  });

  const refresh = useMutation({
    mutationFn: () => request<JobDetail>(`/api/v1/freelancing/jobs/${id}?refresh=true`),
    onSuccess: (next) => queryClient.setQueryData(key, next),
  });
  const hide = useMutation({
    mutationFn: () =>
      request<JobCard>(`/api/v1/freelancing/jobs/${id}/hide`, { method: data?.hidden_at ? "DELETE" : "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(key, (current: JobDetail | undefined) => current && { ...current, ...next });
      invalidateFreelancing(queryClient);
    },
  });

  if (isLoading || !data) {
    if (error) return <ErrorAlert>{(error as Error).message}</ErrorAlert>;
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const client = data.client;
  const activity = data.activity ?? {};

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/freelancing/jobs">
          <ArrowLeft />
          Back to jobs
        </Link>
      </Button>

      <PageHero
        size="page"
        eyebrow={data.track_stage ? STAGE_LABEL[data.track_stage] : "Posting"}
        eyebrowIcon={data.track_stage ? KanbanSquare : Star}
        title={data.title}
        description={
          <span className="text-subtle text-xs">
            Posted {timeAgo(data.published_at)}
            {data.renewed_at ? ` · renewed ${timeAgo(data.renewed_at)}` : ""}
            {data.category ? ` · ${data.subcategory ?? data.category}` : ""}
            {data.detail_fetched_at ? ` · details from ${formatDateTime(data.detail_fetched_at, "d MMM, HH:mm")}` : ""}
            {data.status === "CLOSED" ? " · closed on Upwork" : ""}
          </span>
        }
        actions={
          <>
            <Button variant="brand" size="lg" className="h-11" onClick={() => setDrafting(true)}>
              <FileSignature />
              Draft a proposal
            </Button>
            <Button
              variant={data.focused_at ? "secondary" : "outline"}
              size="lg"
              className="h-11"
              asChild
            >
              <span>
                <FocusButton
                  job={data}
                  size="default"
                  onChange={(next) =>
                    queryClient.setQueryData(key, (current: JobDetail | undefined) => current && { ...current, ...next })
                  }
                />
                {data.focused_at ? "Focused" : "Focus"}
              </span>
            </Button>
            {data.url && (
              <Button asChild size="lg" variant="outline" className="h-11">
                <a href={data.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Upwork
                </a>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardContent className="space-y-4">
              <JobMetaChips job={data} />
              {data.preferred_freelancer_location.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Preferred freelancer location: {data.preferred_freelancer_location.join(", ")}
                </p>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.description ?? "No description."}</p>
              {data.skills.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 pt-1">
                  {data.skills.map((skill) => (
                    <li key={skill} className="rounded-full border px-2.5 py-0.5 text-xs">
                      {skill}
                    </li>
                  ))}
                </ul>
              )}
              {data.attachments.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {data.attachments.map((a, index) => (
                    <li key={a.id ?? index} className="text-sm">
                      {a.link ? (
                        <a href={a.link} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1.5 hover:underline">
                          <Paperclip className="size-3.5" />
                          {a.fileName ?? "Attachment"}
                        </a>
                      ) : (
                        <span className="text-muted-foreground inline-flex items-center gap-1.5">
                          <Paperclip className="size-3.5" />
                          {a.fileName ?? "Attachment"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {data.screening_questions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Screening questions</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-2 pl-5 text-sm">
                  {data.screening_questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ol>
                {data.cover_letter_required === false && (
                  <p className="text-subtle mt-3 text-xs">A cover letter is optional for this posting.</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between border-b py-4">
              <CardTitle className="text-base">Your proposals for this posting</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setDrafting(true)}>
                <FileSignature />
                New draft
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {!proposals.data?.items.length ? (
                <EmptyState title="No proposal yet" description="Draft one here; it starts from your profile and this posting." />
              ) : (
                <ul className="divide-y">
                  {proposals.data.items.map((p) => (
                    <li key={p.id} className="hover:bg-muted/40 relative transition-colors">
                      <div className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/freelancing/proposals/${p.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">
                            {describeEngine(p.engine_version)}
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            {p.bid_amount != null ? `${money(p.bid_amount)}${p.bid_type === "hourly" ? "/hr" : ""} · ` : ""}
                            updated {timeAgo(p.updated_at)}
                          </p>
                        </div>
                        <StatusBadge tone={PROPOSAL_STATUS_LABEL[p.status].tone} className="relative z-10">
                          {PROPOSAL_STATUS_LABEL[p.status].label}
                        </StatusBadge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <SidePanel icon={BadgeCheck} title="Client">
            <FactList
              items={[
                ...(client.contact_name ? [{ label: "Name", value: client.contact_name }] : []),
                { label: "Location", value: [client.city, client.state, client.country].filter(Boolean).join(", ") || "—" },
                {
                  label: "Payment",
                  value: client.payment_verified ? <span className="text-success">Verified</span> : client.payment_verified === false ? "Unverified" : "—",
                },
                { label: "Total spent", value: client.total_spent_display ?? money(client.total_spent) },
                ...(client.hire_rate_percent != null
                  ? [{ label: "Hire rate", value: `${Math.round(client.hire_rate_percent)}%` }]
                  : [{ label: "Hires", value: client.total_hires ?? "—" }]),
                ...(client.avg_hourly_rate != null
                  ? [{ label: "Avg hourly paid", value: `$${client.avg_hourly_rate.toFixed(2)}` }]
                  : []),
                { label: "Jobs posted", value: client.total_posted_jobs ?? "—" },
                {
                  label: "Rating",
                  value: client.feedback != null && client.total_reviews ? `${client.feedback.toFixed(1)}★ · ${client.total_reviews} reviews` : "—",
                },
                { label: "Timezone", value: client.timezone ?? "—", tone: "muted" },
              ]}
            />
          </SidePanel>

          <SidePanel icon={KanbanSquare} title="Activity on this posting">
            <FactList
              items={[
                { label: "Proposals", value: data.total_applicants ?? "—" },
                { label: "Average bid", value: money(activity.average_bid) },
                { label: "Bid range", value: activity.min_bid != null || activity.max_bid != null ? `${money(activity.min_bid)} – ${money(activity.max_bid)}` : "—" },
                { label: "Interviewed at", value: money(activity.average_interviewed_bid) },
                { label: "Invites sent", value: activity.invites_sent ?? "—" },
                {
                  label: "Hired",
                  value:
                    activity.total_hired ??
                    (activity.client_has_hired == null ? "—" : activity.client_has_hired ? "Someone already" : "Nobody yet"),
                },
                { label: "Last client activity", value: activity.last_client_activity ? timeAgo(activity.last_client_activity) : "—", tone: "muted" },
                { label: "Where", value: data.on_site_type ? humanizeEnum(data.on_site_type) : "—", tone: "muted" },
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {canRefresh && (
                <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                  {refresh.isPending ? <Spinner /> : <RefreshCw />}
                  Refresh from {source.data?.label ?? "the source"}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={hide.isPending} onClick={() => hide.mutate()}>
                <EyeOff />
                {data.hidden_at ? "Unhide" : "Hide"}
              </Button>
            </div>
            {refresh.error && <p className="text-destructive mt-2 text-xs">{(refresh.error as Error).message}</p>}
          </SidePanel>

          <Requirements qualification={data.qualification} />

          {data.track_stage && (
            <SidePanel icon={KanbanSquare} title="Tracking">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge tone={STAGE_TONE[data.track_stage]}>{STAGE_LABEL[data.track_stage]}</StatusBadge>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/freelancing/tracking?job=${data.id}`}>Open the track</Link>
                </Button>
              </div>
            </SidePanel>
          )}
        </aside>
      </div>

      <NewProposalDialog open={drafting} jobId={data.id} onClose={() => setDrafting(false)} />
    </div>
  );
}

/** What the posting asks of the freelancer, when the source says. */
function Requirements({ qualification }: { qualification: Record<string, unknown> }) {
  const english = qualification.englishProficiency as string | undefined;
  const contractor = qualification.contractorType as string | undefined;
  const languages = Array.isArray(qualification.languages) ? (qualification.languages as string[]) : [];
  const success = qualification.jobSuccessScore as number | undefined;
  const items = [
    english && english !== "ANY" ? { label: "English", value: humanizeEnum(english) } : null,
    contractor && contractor !== "ANY" && contractor !== "ALL" ? { label: "Open to", value: humanizeEnum(contractor) } : null,
    languages.length ? { label: "Languages", value: languages.join(", ") } : null,
    typeof success === "number" && success > 0 ? { label: "Job success", value: `${success}%+` } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  if (!items.length) return null;
  return (
    <SidePanel icon={BadgeCheck} title="Requirements">
      <FactList items={items} />
    </SidePanel>
  );
}
