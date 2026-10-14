"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  ExternalLink,
  EyeOff,
  FileSignature,
  KanbanSquare,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { FocusButton, JobMetaChips } from "@/components/freelancing/job-card";
import { useJobSource } from "@/components/freelancing/job-source";
import { NewProposalDialog } from "@/components/freelancing/new-proposal-dialog";
import { SectionHead } from "@/components/section-head";
import { StatusBadge } from "@/components/status-badge";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

/** "$60–$90/hr" -> the number big and the unit small; anything else stays whole. */
function splitUnit(text: string, unit: RegExp): { value: string; unit?: string } {
  const match = text.match(unit);
  return match ? { value: match[1].trim().replace(/\s+to\s+/, "–"), unit: match[2].trim() } : { value: text };
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

  const budget = splitUnit(formatBudget(data), /^(.*?)(\/hr| fixed)$/);
  const headline: { value: string; unit?: string; label: string }[] = [
    { ...budget, label: data.job_type === "fixed" ? "Fixed price" : "Hourly budget" },
    ...(data.duration_label ? [{ ...splitUnit(data.duration_label, /^(.*?)\s+(months?|weeks?)$/i), label: "Duration" }] : []),
    ...(data.workload ? [{ ...splitUnit(data.workload, /^(.*?)\s*(hrs\/week|hours\/week)$/i), label: "Workload" }] : []),
    ...(data.connects_required != null
      ? [{ value: String(data.connects_required), unit: "connects", label: "To apply" }]
      : []),
  ];

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <Link
          href="/freelancing/jobs"
          aria-label="Back to jobs"
          className="bg-card shadow-card focus-visible:ring-ring/40 mt-1 grid size-14 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 basis-80">
          {data.track_stage && (
            <StatusBadge tone={STAGE_TONE[data.track_stage]} className="mb-3">
              <KanbanSquare />
              {STAGE_LABEL[data.track_stage]}
            </StatusBadge>
          )}
          <h1 className="max-w-[660px] text-3xl leading-[1.12] font-medium tracking-tight text-balance sm:text-4xl">
            {data.title}
          </h1>
          <p className="text-muted-foreground mt-2.5 text-[13.5px] font-medium">
            Posted {timeAgo(data.published_at)}
            {data.renewed_at ? ` · renewed ${timeAgo(data.renewed_at)}` : ""}
            {data.category ? ` · ${data.subcategory ?? data.category}` : ""}
            {data.detail_fetched_at ? ` · details from ${formatDateTime(data.detail_fetched_at, "d MMM, HH:mm")}` : ""}
            {data.status === "CLOSED" ? " · closed on Upwork" : ""}
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <FocusButton
            job={data}
            variant="pill"
            onChange={(next) =>
              queryClient.setQueryData(key, (current: JobDetail | undefined) => current && { ...current, ...next })
            }
          />
          {data.url && (
            <Button asChild size="lg" variant="secondary">
              <a href={data.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Upwork
              </a>
            </Button>
          )}
          <Button variant="brand" size="lg" className="pl-2.5" onClick={() => setDrafting(true)}>
            <span className="grid size-8 place-items-center rounded-full bg-black/12">
              <FileSignature />
            </span>
            Draft a proposal
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26.5rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Card className="gap-0 px-6 py-7 sm:px-8">
            <dl className="flex flex-wrap gap-x-8 gap-y-5 lg:grid lg:auto-cols-[minmax(max-content,1fr)] lg:grid-flow-col lg:gap-0">
              {headline.map(({ value, unit, label }) => (
                <div key={label} className="lg:border-l lg:px-6 lg:first:border-l-0 lg:first:pl-0">
                  <dd
                    className={cn(
                      "order-first font-medium tracking-tight whitespace-nowrap tabular-nums",
                      value.length > 11 ? "text-2xl leading-[1.3]" : "text-[2.375rem] leading-none",
                    )}
                  >
                    {value}
                    {unit && <small className="text-muted-foreground ml-1 text-[17px] font-medium tracking-normal">{unit}</small>}
                  </dd>
                  <dt className="text-muted-foreground mt-2 text-[13px] font-semibold">{label}</dt>
                </div>
              ))}
            </dl>
            <div className="border-border my-6 border-t" />

            <div className="flex flex-wrap items-center gap-2">
              <JobMetaChips job={data} detail />
            </div>
            {data.preferred_freelancer_location.length > 0 && (
              <p className="text-muted-foreground mt-3.5 text-[13.5px]">
                Preferred freelancer location: {data.preferred_freelancer_location.join(", ")}
              </p>
            )}

            <Description text={data.description} />

            {data.skills.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-[7px]">
                {data.skills.map((skill) => (
                  <li key={skill}>
                    <Badge variant="outline" className="h-[30px] px-3.5 text-[13px] font-semibold">
                      {skill}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {data.attachments.length > 0 && (
              <ul className="mt-5 flex flex-wrap gap-2.5">
                {data.attachments.map((a, index) => {
                  const name = a.fileName ?? "Attachment";
                  const inner = (
                    <>
                      <Tile icon={Paperclip} size="sm" className="size-8 rounded-full [&_svg]:size-[15px]" />
                      {name}
                    </>
                  );
                  const pill = "bg-soft inline-flex h-[46px] items-center gap-2.5 rounded-full pr-[18px] pl-2 text-sm font-semibold";
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
          </Card>

          {data.screening_questions.length > 0 && (
            <Card className="gap-0 px-6 pt-6 pb-4 sm:px-8">
              <SectionHead title="Screening questions" count={`${data.screening_questions.length} ${data.screening_questions.length === 1 ? "question" : "questions"}`} className="mb-2" />
              <ol>
                {data.screening_questions.map((q, index) => (
                  <li key={q} className="flex items-start gap-4 border-t py-4 first:border-t-0">
                    <span className="bg-primary text-brand grid size-[30px] shrink-0 place-items-center rounded-full text-[13.5px] font-bold">
                      {index + 1}
                    </span>
                    <p className="pt-[3px] text-[15.5px] leading-normal font-medium">{q}</p>
                  </li>
                ))}
              </ol>
              {data.cover_letter_required === false && (
                <p className="text-muted-foreground mt-1 border-t pt-3.5 pb-2 text-[13.5px]">
                  A cover letter is optional for this posting.
                </p>
              )}
            </Card>
          )}

          <Card className="gap-0 px-6 pt-6 pb-3 sm:px-8">
            <SectionHead title="Your proposals for this posting" className="mb-1">
              <Button size="xs" variant="outline" onClick={() => setDrafting(true)}>
                <FileSignature />
                New draft
              </Button>
            </SectionHead>
            {!proposals.data?.items.length ? (
              <EmptyState title="No proposal yet" description="Draft one here; it starts from your profile and this posting." />
            ) : (
              <ul>
                {proposals.data.items.map((p) => (
                  <li key={p.id} className="relative flex items-center gap-3.5 border-t py-3.5 first:border-t-0 sm:gap-4">
                    <Tile icon={FileSignature} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/freelancing/proposals/${p.id}`} className="block truncate font-semibold after:absolute after:inset-0">
                        {describeEngine(p.engine_version)}
                      </Link>
                      <p className="text-muted-foreground text-[13px] font-medium">
                        {p.bid_amount != null ? `${money(p.bid_amount)}${p.bid_type === "hourly" ? "/hr" : ""} · ` : ""}
                        updated {timeAgo(p.updated_at)}
                      </p>
                    </div>
                    <StatusBadge tone={PROPOSAL_STATUS_LABEL[p.status].tone}>{PROPOSAL_STATUS_LABEL[p.status].label}</StatusBadge>
                    <span aria-hidden className="bg-soft grid size-9 shrink-0 place-items-center rounded-full">
                      <ArrowUpRight className="size-4" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24">
          {data.track_stage && (
            <Card tone="accent" className="gap-0 rounded-[32px] px-6 py-5.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Tile icon={KanbanSquare} tone="ink" />
                  <div>
                    <p className="text-sm font-semibold opacity-60">Tracking</p>
                    <p className="text-xl font-bold tracking-tight">{STAGE_LABEL[data.track_stage]}</p>
                  </div>
                </div>
                <Button asChild size="sm">
                  <Link href={`/freelancing/tracking?job=${data.id}`}>
                    Open the track
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            </Card>
          )}

          <Panel icon={BadgeCheck} title="Client" tone="dark">
            <Facts
              items={[
                ...(client.contact_name ? [{ label: "Name", value: client.contact_name }] : []),
                { label: "Location", value: [client.city, client.state, client.country].filter(Boolean).join(", ") || "—" },
                {
                  label: "Payment",
                  value: client.payment_verified ? (
                    <span className="text-success inline-flex items-center gap-1.5 group-data-[tone=dark]/card:brightness-125">
                      <BadgeCheck className="size-[15px]" />
                      Verified
                    </span>
                  ) : client.payment_verified === false ? (
                    "Unverified"
                  ) : (
                    "—"
                  ),
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
                { label: "Timezone", value: client.timezone ?? "—", muted: true },
              ]}
            />
          </Panel>

          <Panel icon={KanbanSquare} title="Activity on this posting">
            <Facts
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
                { label: "Last client activity", value: activity.last_client_activity ? timeAgo(activity.last_client_activity) : "—", muted: true },
                { label: "Where", value: data.on_site_type ? humanizeEnum(data.on_site_type) : "—", muted: true },
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {canRefresh && (
                <Button size="xs" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                  {refresh.isPending ? <Spinner /> : <RefreshCw />}
                  Refresh from {source.data?.label ?? "the source"}
                </Button>
              )}
              <Button size="xs" variant="ghost" className="bg-soft hover:bg-soft-2" disabled={hide.isPending} onClick={() => hide.mutate()}>
                <EyeOff />
                {data.hidden_at ? "Unhide" : "Hide"}
              </Button>
            </div>
            {refresh.error && <p className="text-destructive mt-2 text-xs">{(refresh.error as Error).message}</p>}
          </Panel>

          <Requirements qualification={data.qualification} />
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
  if (!text?.trim()) return <p className="text-muted-foreground mt-5 text-[15.5px]">No description.</p>;
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n").filter((line) => line.trim()))
    .filter((lines) => lines.length);
  const bullet = /^\s*[-•*]\s+/;
  return (
    <div className="text-foreground/85 mt-5 space-y-3.5 text-[15.5px] leading-[1.65]">
      {blocks.map((lines, index) => {
        if (lines.every((line) => bullet.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5 leading-[1.55]">
              {lines.map((line) => (
                <li key={line}>{line.replace(bullet, "")}</li>
              ))}
            </ul>
          );
        }
        if (lines.length === 1 && lines[0].length <= 60 && !/[.!?,;]$/.test(lines[0].trim()) && index > 0) {
          return (
            <h4 key={index} className="text-foreground !mt-6 text-[15px] font-bold">
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

/** A side card: a leading mark, a title, and facts beneath. */
function Panel({
  icon: Icon,
  title,
  tone = "default",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  tone?: "default" | "dark";
  children: ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <Card tone={tone} className={cn("gap-0 px-6 pt-6 pb-4", dark ? "rounded-[36px]" : "rounded-[32px]")}>
      <div className="mb-1.5 flex items-center gap-2.5">
        {dark ? (
          <span className="bg-panel-raised grid size-9 place-items-center rounded-full">
            <Icon className="size-[18px]" />
          </span>
        ) : (
          <Tile icon={Icon} size="sm" />
        )}
        <h2 className={cn("font-medium tracking-tight", dark ? "text-2xl" : "text-[21px]")}>{title}</h2>
      </div>
      {children}
    </Card>
  );
}

/** Label/value rows with a rule between them. */
function Facts({ items }: { items: { label: string; value: ReactNode; muted?: boolean }[] }) {
  return (
    <dl>
      {items.map(({ label, value, muted }) => (
        <div
          key={label}
          className="group-data-[tone=dark]/card:border-panel-raised flex items-baseline justify-between gap-4 border-t py-3 text-[14.5px] first:border-t-0"
        >
          <dt className="text-muted-foreground group-data-[tone=dark]/card:text-panel-muted shrink-0 font-medium">{label}</dt>
          <dd
            className={cn(
              "text-right font-semibold",
              muted && "text-muted-foreground group-data-[tone=dark]/card:text-panel-muted font-medium",
            )}
          >
            {value}
          </dd>
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
    <Panel icon={BadgeCheck} title="Requirements">
      <Facts items={items} />
    </Panel>
  );
}
