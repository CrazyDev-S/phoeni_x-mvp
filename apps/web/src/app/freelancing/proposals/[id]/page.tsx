"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, ExternalLink, Eye, Save, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDelete } from "@/components/confirm-delete";
import { ErrorAlert } from "@/components/error-alert";
import { ProposalRead } from "@/components/freelancing/proposal-read";
import { ProposalWriter } from "@/components/freelancing/proposal-writer";
import { PageHero } from "@/components/page-hero";
import { Panel, PanelHead } from "@/components/panel";
import { StyleBar } from "@/components/text-style/style-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";
import {
  describeEngine,
  formatBudget,
  invalidateFreelancing,
  PROPOSAL_STATUS_LABEL,
  timeAgo,
  type FreelancerProfile,
  type Proposal,
  type ProposalAnswer,
  type ProposalStatus,
} from "@/lib/freelancing";
import {
  isSaved,
  proposalVersionsKey,
  proposalVersionsPath,
  versionLabel,
  type ProposalVersion,
  type ProposalVersions,
} from "@/lib/proposal-writer";
import { cn } from "@/lib/utils";

const NO_PROFILE = "__none";

export default function ProposalPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ProposalEditor />
    </Suspense>
  );
}

function ProposalEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = ["freelancing", "proposal", id];

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => request<Proposal>(`/api/v1/freelancing/proposals/${id}`),
  });
  const profiles = useQuery({
    queryKey: ["freelancing", "profiles"],
    queryFn: () => request<FreelancerProfile[]>("/api/v1/freelancing/profiles"),
  });
  // Shared with the writer panel, which owns refetching it.
  const versions = useQuery({
    queryKey: proposalVersionsKey(id),
    queryFn: () => request<ProposalVersions>(proposalVersionsPath(id)),
  });

  const [activeEditorTab, setActiveEditorTab] = useState<"write" | "review" | "compare">("write");
  const [letter, setLetter] = useState("");
  const [answers, setAnswers] = useState<ProposalAnswer[]>([]);
  const [bidType, setBidType] = useState<string>("");
  const [bidAmount, setBidAmount] = useState("");
  const [connects, setConnects] = useState("");
  const [status, setStatus] = useState<ProposalStatus>("draft");
  const [profileId, setProfileId] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const loadedVersion = useRef<string | null>(null);
  const letterRef = useRef<HTMLTextAreaElement>(null);

  // The editor holds the proposal as the server has it: on load, after a save,
  // when a draft lands, and when a version is deleted.
  useEffect(() => {
    if (!data) return;
    const version = `${data.updated_at}:${data.version_id}`;
    if (loadedVersion.current === version) return;
    loadedVersion.current = version;
    setLetter(data.cover_letter_markdown);
    setAnswers(data.answers);
    setBidType(data.bid_type ?? "");
    setBidAmount(data.bid_amount == null ? "" : String(data.bid_amount));
    setConnects(data.connects_estimate == null ? "" : String(data.connects_estimate));
    setStatus(data.status);
    setProfileId(data.profile_id ?? "");
    setActiveId(data.version_id);
    setDirty(false);
  }, [data]);

  const onChanged = useCallback(
    (next?: Proposal) => {
      if (next) queryClient.setQueryData(["freelancing", "proposal", id], next);
      invalidateFreelancing(queryClient);
    },
    [queryClient, id],
  );

  /** Put a version's letter and answers in the editor; Save makes it the next whole version. */
  const applyVersion = useCallback(
    (version: ProposalVersion) => {
      setLetter(version.document.cover_letter_markdown);
      setAnswers(version.document.answers);
      setActiveId(version.id);
      setDirty(version.id !== data?.version_id);
    },
    [data?.version_id],
  );

  const save = useMutation({
    mutationFn: () =>
      request<Proposal>(`/api/v1/freelancing/proposals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          cover_letter_markdown: letter,
          answers,
          bid_type: bidType || null,
          bid_amount: bidAmount.trim() === "" ? null : Number(bidAmount),
          connects_estimate: connects.trim() === "" ? null : Number(connects),
          status,
          profile_id: profileId || null,
          version_id: activeId,
        }),
      }),
    onSuccess: (next) => {
      onChanged(next);
      toast.success("Proposal saved");
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return request<Proposal>(`/api/v1/freelancing/proposals/${id}/submit`, { method: "POST" });
    },
    onSuccess: (next) => {
      onChanged(next);
      toast.success("Marked as submitted");
    },
  });

  const copyText = () => {
    void navigator.clipboard.writeText(letter);
    toast.success("Copied, ready to paste into Upwork");
  };

  if (isLoading || !data) {
    if (error) return <ErrorAlert>{(error as Error).message}</ErrorAlert>;
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const active = versions.data?.items.find((v) => v.id === activeId) ?? null;
  const wordCount = letter.trim() ? letter.trim().split(/\s+/).filter(Boolean).length : 0;
  const job = data.job;
  const answered = answers.filter((a) => a.answer.trim()).length;
  const profileList = Array.isArray(profiles.data) ? profiles.data : [];
  const budget = job ? formatBudget(job) : null;
  const stats = [
    { value: wordCount, label: "Words" },
    ...(answers.length ? [{ value: `${answered}/${answers.length}`, label: "Answered" }] : []),
    ...(connects.trim() ? [{ value: connects, label: "Connects" }] : []),
  ];
  const posted = [
    job?.client_country,
    job?.published_at ? `Posted ${timeAgo(job.published_at)}` : null,
    job?.focused_at ? `Focused ${format(new Date(job.focused_at), "d MMM")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const badge = dirty
    ? { variant: "warning" as const, text: active ? `Unsaved · ${versionLabel(active)}` : "Unsaved" }
    : active
      ? { variant: "secondary" as const, text: isSaved(active) ? `Version ${versionLabel(active)}` : `Draft ${versionLabel(active)}` }
      : { variant: "secondary" as const, text: `Saved ${timeAgo(data.updated_at)}` };

  return (
    <div className="space-y-3">
      <PageHero
        title="Proposal"
        back="/freelancing/proposals"
        stats={stats}
        badge={<Badge variant={badge.variant}>{badge.text}</Badge>}
        actions={
          <>
            <ConfirmDelete
              label={job?.title || "this proposal"}
              description="This permanently removes the proposal, all its versions and its place in your pipeline. This cannot be undone."
              onDelete={async () => {
                await request(`/api/v1/freelancing/proposals/${id}`, { method: "DELETE" });
              }}
              onDeleted={() => {
                invalidateFreelancing(queryClient);
                toast.success("Proposal deleted");
                router.push("/freelancing/proposals");
              }}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Delete proposal" className="hover:text-destructive">
                  <Trash2 />
                </Button>
              }
            />
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Save />}
              Save
            </Button>
            <Button variant="brand" onClick={() => submit.mutate()} disabled={submit.isPending || !letter.trim()}>
              {submit.isPending ? <Spinner /> : <Send />}
              Mark submitted
            </Button>
          </>
        }
      />

      {(save.error || submit.error) && (
        <ErrorAlert>{((save.error ?? submit.error) as Error).message}</ErrorAlert>
      )}

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <ProposalWriter
            proposal={data}
            profileId={profileId || null}
            active={active}
            writing={() => ({ cover_letter_markdown: letter, answers })}
            onApply={applyVersion}
            onChanged={onChanged}
          />

          {/* The letter */}
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
              <Tabs value={activeEditorTab} onValueChange={(v) => setActiveEditorTab(v as typeof activeEditorTab)}>
                <TabsList>
                  <TabsTrigger value="write">Write</TabsTrigger>
                  <TabsTrigger value="review">Review</TabsTrigger>
                  <TabsTrigger value="compare">Compare</TabsTrigger>
                </TabsList>
              </Tabs>

              <StyleBar target={letterRef} lists disabled={activeEditorTab !== "write"} />

              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  aria-pressed={activeEditorTab === "review"}
                  onClick={() => setActiveEditorTab((t) => (t === "review" ? "write" : "review"))}
                >
                  <Eye />
                  Preview
                </Button>
                <Button variant="ghost" size="xs" onClick={copyText} disabled={!letter.trim()}>
                  <Copy />
                  Copy
                </Button>
              </div>
            </div>

            {activeEditorTab === "write" && (
              <Textarea
                ref={letterRef}
                styleBar="inline"
                aria-label="Cover letter"
                value={letter}
                onChange={(e) => {
                  setLetter(e.target.value);
                  setDirty(true);
                }}
                placeholder="The proposal writer drafts the letter here, or write it yourself."
                className="min-h-[24rem] resize-none rounded-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0"
              />
            )}
            {activeEditorTab === "review" && (
              <div className="min-h-[24rem] space-y-3 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                {letter.trim() ? <p>{letter}</p> : <p className="text-muted-foreground">Nothing written yet.</p>}
                {answers.some((a) => a.answer.trim()) && (
                  <div className="space-y-2 border-t pt-3">
                    {answers
                      .filter((a) => a.answer.trim())
                      .map((a, i) => (
                        <div key={i}>
                          <p className="text-muted-foreground font-medium">{a.question}</p>
                          <p>{a.answer}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            {activeEditorTab === "compare" && (
              <div className="grid min-h-[24rem] gap-2 p-3 md:grid-cols-2">
                {[
                  ["Saved", data.cover_letter_markdown],
                  ["Your edits", letter],
                ].map(([label, text]) => (
                  <div key={label} className="bg-muted/50 min-w-0 rounded-md p-3">
                    <p className="text-muted-foreground mb-1 text-[11px] font-semibold tracking-wide uppercase">{label}</p>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{text.trim() ? text : "Nothing written yet."}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Screening questions */}
          {answers.length > 0 && (
            <Panel>
              <PanelHead title="Screening questions" count={`${answered}/${answers.length} answered`} />
              <div className="divide-y">
                {answers.map((a, i) => (
                  <div key={i} className="space-y-1.5 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor={`answer-${i}`} className="text-[13px] font-medium">
                        {i + 1}. {a.question}
                      </label>
                      {!a.answer.trim() && <Badge variant="warning">Unanswered</Badge>}
                    </div>
                    <Textarea
                      id={`answer-${i}`}
                      value={a.answer}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAnswers((prev) => prev.map((x, j) => (j === i ? { ...x, answer: value } : x)));
                        setDirty(true);
                      }}
                      placeholder="Your answer"
                      className="min-h-16"
                    />
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <aside className="min-w-0 space-y-3">
          {active && <ProposalRead version={active} />}

          <Panel>
            {/* Posting */}
            {job && (
              <section className="space-y-1.5 px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[13px] leading-snug font-semibold">{job.title}</h2>
                  {job.url && (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open the posting on Upwork"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                {posted && <p className="text-muted-foreground text-xs">{posted}</p>}
                <dl className="grid grid-cols-2 gap-x-3 text-xs">
                  {budget && (
                    <div>
                      <dd className="text-[13px] font-semibold">{budget}</dd>
                      <dt className="text-muted-foreground">
                        {job.job_type === "fixed" ? "Fixed price" : job.job_type === "hourly" ? "Hourly rate" : "Budget"}
                      </dt>
                    </div>
                  )}
                  {job.total_applicants != null && (
                    <div>
                      <dd className="text-[13px] font-semibold">{job.total_applicants}</dd>
                      <dt className="text-muted-foreground">Proposals so far</dt>
                    </div>
                  )}
                </dl>
                {job.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {job.skills.map((skill) => (
                      <Badge key={skill} variant="outline">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Bid */}
            <section className="space-y-2 border-t px-3 py-2.5">
              <h2 className="text-[13px] font-semibold">Your bid</h2>
              <div role="radiogroup" aria-label="Bid type" className="bg-muted flex gap-0.5 rounded-md p-0.5">
                {(
                  [
                    ["hourly", "Hourly"],
                    ["fixed", "Fixed"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={bidType === value}
                    onClick={() => {
                      setBidType(value);
                      setDirty(true);
                    }}
                    className={cn(
                      "focus-visible:ring-ring/40 h-7 flex-1 rounded-[5px] text-[13px] font-medium transition-colors outline-none focus-visible:ring-2",
                      bidType === value ? "bg-card shadow-sm" : "text-foreground/65 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="bid-amount" className="text-xs font-medium">
                    Amount ({data.bid_currency ?? "USD"}
                    {bidType === "hourly" ? "/hr" : ""})
                  </label>
                  <div className="relative">
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px]">$</span>
                    <Input
                      id="bid-amount"
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={bidAmount}
                      onChange={(e) => {
                        setBidAmount(e.target.value);
                        setDirty(true);
                      }}
                      className="pl-6"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="bid-connects" className="text-xs font-medium">
                    Connects
                  </label>
                  <Input
                    id="bid-connects"
                    type="number"
                    min={0}
                    max={200}
                    inputMode="numeric"
                    value={connects}
                    onChange={(e) => {
                      setConnects(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="bid-status" className="text-xs font-medium">
                  Status
                </label>
                <Select
                  value={status}
                  onValueChange={(v) => {
                    setStatus(v as ProposalStatus);
                    setDirty(true);
                  }}
                >
                  <SelectTrigger id="bid-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROPOSAL_STATUS_LABEL) as ProposalStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {PROPOSAL_STATUS_LABEL[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="bid-profile" className="text-xs font-medium">
                    Profile
                  </label>
                  <Link href="/freelancing/profile" className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline">
                    Manage
                  </Link>
                </div>
                <Select
                  value={profileId || NO_PROFILE}
                  onValueChange={(v) => {
                    setProfileId(v === NO_PROFILE ? "" : v);
                    setDirty(true);
                  }}
                >
                  <SelectTrigger id="bid-profile" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROFILE}>No profile</SelectItem>
                    {profileList.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.is_default ? " · default" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="flex items-baseline justify-between gap-2 border-t px-3 py-2 text-xs">
              <span className="text-muted-foreground">Written by</span>
              <span className="truncate font-medium">{describeEngine(data.engine_version)}</span>
            </section>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
