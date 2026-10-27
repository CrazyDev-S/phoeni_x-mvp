"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, EyeOff, FileSignature, KanbanSquare, Paperclip, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { FocusButton, JobMetaChips } from "@/components/freelancing/job-list";
import { useJobSource } from "@/components/freelancing/job-source";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { PageHero } from "@/components/page-hero";
import { Panel, PanelHead } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { request } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  describeEngine,
  formatBudget,
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
import { cn } from "@/lib/utils";

function money(value: number | null | undefined): string {
  return value == null ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
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
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const client = data.client;
  const activity = data.activity ?? {};

  // The terms of the posting, as one line under the title.
  const terms = [
    formatBudget(data),
    data.duration_label,
    data.workload,
    data.connects_required != null ? `${data.connects_required} connects` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-3">
      <PageHero
        back="/freelancing/jobs"
        title={<span className="whitespace-normal">{data.title}</span>}
        badge={
          data.track_stage && (
            <Link href={`/freelancing/tracking?job=${data.id}`} title="Open the track">
              <StatusBadge tone={STAGE_TONE[data.track_stage]}>
                <KanbanSquare />
                {STAGE_LABEL[data.track_stage]}
              </StatusBadge>
            </Link>
          )
        }
        actions={
          <>
            <FocusButton
              job={data}
              variant="pill"
              onChange={(next) =>
                queryClient.setQueryData(key, (current: JobDetail | undefined) => current && { ...current, ...next })
              }
            />
            {data.url && (
              <Button asChild variant="outline">
                <a href={data.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Upwork
                </a>
              </Button>
            )}
            <Button variant="brand" onClick={() => setDrafting(true)}>
              <FileSignature />
              Draft a proposal
            </Button>
          </>
        }
      />
      <p className="text-muted-foreground -mt-1 flex flex-wrap items-center gap-x-2 text-xs">
        {terms.map((term, index) => (
          <span key={term} className={cn(index === 0 && "text-foreground text-[13px] font-semibold")}>
            {index > 0 && <span className="mr-2">·</span>}
            {term}
          </span>
        ))}
        <span>
          · posted {timeAgo(data.published_at)}
          {data.renewed_at ? ` · renewed ${timeAgo(data.renewed_at)}` : ""}
          {data.category ? ` · ${data.subcategory ?? data.category}` : ""}
          {data.detail_fetched_at ? ` · details from ${formatDateTime(data.detail_fetched_at, "d MMM, HH:mm")}` : ""}
          {data.status === "CLOSED" ? " · closed on Upwork" : ""}
        </span>
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-3">
          <Panel className="space-y-3 p-4">
            <JobMetaChips job={data} />
            {data.preferred_freelancer_location.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Preferred freelancer location: {data.preferred_freelancer_location.join(", ")}
              </p>
            )}

            <Description text={data.description} />

            {data.skills.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {data.skills.map((skill) => (
                  <li key={skill}>
                    <Badge variant="outline">{skill}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {data.attachments.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {data.attachments.map((a, index) => {
                  const name = a.fileName ?? "Attachment";
                  const inner = (
                    <>
                      <Paperclip className="size-3.5" />
                      {name}
                    </>
                  );
                  const pill = "bg-muted inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium";
                  return (
                    <li key={a.id ?? index}>
                      {a.link ? (
                        <a href={a.link} target="_blank" rel="noreferrer" className={cn(pill, "hover:bg-soft-2 transition-colors")}>
                          {inner}
                        </a>
                      ) : (
                        <span className={cn(pill, "text-muted-foreground")}>{inner}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {data.screening_questions.length > 0 && (
            <Panel>
              <PanelHead title="Screening questions" count={data.screening_questions.length} />
              <ol className="divide-y">
                {data.screening_questions.map((q, index) => (
                  <li key={q} className="flex items-start gap-2.5 px-3 py-2">
                    <span className="text-muted-foreground w-4 shrink-0 text-xs font-semibold tabular-nums">{index + 1}</span>
                    <p className="text-[13px]">{q}</p>
                  </li>
                ))}
              </ol>
              {data.cover_letter_required === false && (
                <p className="text-muted-foreground border-t px-3 py-2 text-xs">A cover letter is optional for this posting.</p>
              )}
            </Panel>
          )}

          <Panel>
            <PanelHead title="Your proposals for this posting" count={proposals.data?.items.length ?? 0}>
              <Button size="xs" variant="outline" onClick={() => setDrafting(true)}>
                <FileSignature />
                New draft
              </Button>
            </PanelHead>
            {!proposals.data?.items.length ? (
              <EmptyState title="No proposal yet." />
            ) : (
              <Table>
                <TableBody>
                  {proposals.data.items.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/freelancing/proposals/${p.id}`)}
                    >
                      <TableCell className="w-full max-w-0">
                        <Link
                          href={`/freelancing/proposals/${p.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate font-medium hover:underline"
                        >
                          {describeEngine(p.engine_version)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {p.bid_amount != null ? `${money(p.bid_amount)}${p.bid_type === "hourly" ? "/hr" : ""}` : "-"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={PROPOSAL_STATUS_LABEL[p.status].tone}>{PROPOSAL_STATUS_LABEL[p.status].label}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{timeAgo(p.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-14">
          <Panel>
            <FactGroup title="Client">
              <Facts
                items={[
                  ...(client.contact_name ? [{ label: "Name", value: client.contact_name }] : []),
                  { label: "Location", value: [client.city, client.state, client.country].filter(Boolean).join(", ") || "-" },
                  {
                    label: "Payment",
                    value: client.payment_verified ? (
                      <span className="text-success inline-flex items-center gap-1">
                        <BadgeCheck className="size-3.5" />
                        Verified
                      </span>
                    ) : client.payment_verified === false ? (
                      "Unverified"
                    ) : (
                      "-"
                    ),
                  },
                  { label: "Total spent", value: client.total_spent_display ?? money(client.total_spent) },
                  ...(client.hire_rate_percent != null
                    ? [{ label: "Hire rate", value: `${Math.round(client.hire_rate_percent)}%` }]
                    : [{ label: "Hires", value: client.total_hires ?? "-" }]),
                  ...(client.avg_hourly_rate != null
                    ? [{ label: "Avg hourly paid", value: `$${client.avg_hourly_rate.toFixed(2)}` }]
                    : []),
                  { label: "Jobs posted", value: client.total_posted_jobs ?? "-" },
                  {
                    label: "Rating",
                    value: client.feedback != null && client.total_reviews ? `${client.feedback.toFixed(1)}★ · ${client.total_reviews} reviews` : "-",
                  },
                  { label: "Timezone", value: client.timezone ?? "-", muted: true },
                ]}
              />
            </FactGroup>

            <FactGroup title="Activity on this posting">
              <Facts
                items={[
                  { label: "Proposals", value: data.total_applicants ?? "-" },
                  { label: "Average bid", value: money(activity.average_bid) },
                  { label: "Bid range", value: activity.min_bid != null || activity.max_bid != null ? `${money(activity.min_bid)} – ${money(activity.max_bid)}` : "-" },
                  { label: "Interviewed at", value: money(activity.average_interviewed_bid) },
                  { label: "Invites sent", value: activity.invites_sent ?? "-" },
                  {
                    label: "Hired",
                    value:
                      activity.total_hired ??
                      (activity.client_has_hired == null ? "-" : activity.client_has_hired ? "Someone already" : "Nobody yet"),
                  },
                  { label: "Last client activity", value: activity.last_client_activity ? timeAgo(activity.last_client_activity) : "-", muted: true },
                  { label: "Where", value: data.on_site_type ? humanizeEnum(data.on_site_type) : "-", muted: true },
                ]}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {canRefresh && (
                  <Button size="xs" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                    {refresh.isPending ? <Spinner /> : <RefreshCw />}
                    Refresh from {source.data?.label ?? "the source"}
                  </Button>
                )}
                <Button size="xs" variant="outline" disabled={hide.isPending} onClick={() => hide.mutate()}>
                  <EyeOff />
                  {data.hidden_at ? "Unhide" : "Hide"}
                </Button>
              </div>
              {refresh.error && <p className="text-destructive mt-1.5 text-xs">{(refresh.error as Error).message}</p>}
            </FactGroup>

            <Requirements qualification={data.qualification} />
          </Panel>
        </aside>
      </div>

      <NewProposalDialog open={drafting} jobId={data.id} onClose={() => setDrafting(false)} />
    </div>
  );
}

/**
 * The posting's text. Upwork sends plain text, so structure is read from its
 * shape: a run of "-" or "•" lines is a list, and a short line with no full
 * stop between paragraphs is a heading.
 */
function Description({ text }: { text: string | null }) {
  if (!text?.trim()) return <p className="text-muted-foreground text-[13px]">No description.</p>;
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n").filter((line) => line.trim()))
    .filter((lines) => lines.length);
  const bullet = /^\s*[-•*]\s+/;
  return (
    <div className="text-foreground/85 space-y-2 text-[13px] leading-relaxed">
      {blocks.map((lines, index) => {
        if (lines.every((line) => bullet.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-0.5 pl-5">
              {lines.map((line) => (
                <li key={line}>{line.replace(bullet, "")}</li>
              ))}
            </ul>
          );
        }
        if (lines.length === 1 && lines[0].length <= 60 && !/[.!?,;]$/.test(lines[0].trim()) && index > 0) {
          return (
            <h4 key={index} className="text-foreground !mt-3 text-[13px] font-semibold">
              {lines[0].trim()}
            </h4>
          );
        }
        return (
          <p key={index} className="whitespace-pre-line">
            {lines.join("\n")}
          </p>
        );
      })}
    </div>
  );
}

/** A titled block of facts in the fact column; blocks are ruled apart. */
function FactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t px-3 py-2 first:border-t-0">
      <h2 className="mb-1 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Label/value rows. */
function Facts({ items }: { items: { label: string; value: ReactNode; muted?: boolean }[] }) {
  return (
    <dl>
      {items.map(({ label, value, muted }) => (
        <div key={label} className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
          <dt className="text-muted-foreground shrink-0">{label}</dt>
          <dd className={cn("text-right font-medium", muted && "text-muted-foreground font-normal")}>{value}</dd>
        </div>
      ))}
    </dl>
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
    <FactGroup title="Requirements">
      <Facts items={items} />
    </FactGroup>
  );
}
