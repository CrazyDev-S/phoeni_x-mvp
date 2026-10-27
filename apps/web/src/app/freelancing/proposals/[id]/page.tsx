"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bold, Code, Copy, ExternalLink, Eye, Italic, Link as LinkIcon, List, ListOrdered, Quote, Save, Send, Strikethrough } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/error-alert";
import { PageHero } from "@/components/page-hero";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { Panel, PanelHead } from "@/components/panel";
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
import { useGeneration } from "@/hooks/use-generation";
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
import { cn } from "@/lib/utils";

type Format = "bold" | "italic" | "strike" | "code" | "link" | "bullets" | "numbers" | "quote";

const TOOLBAR: { format: Format; label: string; icon: ComponentType<{ className?: string }> }[][] = [
  [
    { format: "bold", label: "Bold", icon: Bold },
    { format: "italic", label: "Italic", icon: Italic },
    { format: "strike", label: "Strikethrough", icon: Strikethrough },
  ],
  [
    { format: "bullets", label: "Bulleted list", icon: List },
    { format: "numbers", label: "Numbered list", icon: ListOrdered },
    { format: "quote", label: "Quote", icon: Quote },
    { format: "code", label: "Code", icon: Code },
    { format: "link", label: "Link", icon: LinkIcon },
  ],
];

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
  const searchParams = useSearchParams();
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

  const [activeEditorTab, setActiveEditorTab] = useState<"write" | "review" | "compare">("write");
  const [letter, setLetter] = useState("");
  const [answers, setAnswers] = useState<ProposalAnswer[]>([]);
  const [bidType, setBidType] = useState<string>("");
  const [bidAmount, setBidAmount] = useState("");
  const [connects, setConnects] = useState("");
  const [status, setStatus] = useState<ProposalStatus>("draft");
  const [profileId, setProfileId] = useState("");
  const [dirty, setDirty] = useState(false);
  const loadedVersion = useRef<string | null>(null);
  const letterRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!data) return;
    const version = `${data.updated_at}:${data.engine_version}`;
    if (loadedVersion.current === version) return;
    loadedVersion.current = version;
    setLetter(data.cover_letter_markdown);
    setAnswers(data.answers);
    setBidType(data.bid_type ?? "");
    setBidAmount(data.bid_amount == null ? "" : String(data.bid_amount));
    setConnects(data.connects_estimate == null ? "" : String(data.connects_estimate));
    setStatus(data.status);
    setProfileId(data.profile_id ?? "");
    setDirty(false);
  }, [data]);

  const generation = useGeneration();
  const followed = useRef(false);
  useEffect(() => {
    const generationId = searchParams.get("generation");
    if (!generationId || followed.current) return;
    followed.current = true;
    generation.attach(generationId);
    router.replace(`/freelancing/proposals/${id}`, { scroll: false });
  }, [searchParams, generation, id, router]);

  useEffect(() => {
    if (!generation.state.running && generation.state.resultId) {
      queryClient.invalidateQueries({ queryKey: key });
      invalidateFreelancing(queryClient);
    }
  }, [generation.state.running, generation.state.resultId, queryClient, key]);

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
        }),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      invalidateFreelancing(queryClient);
      setDirty(false);
      toast.success("Proposal saved successfully");
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return request<Proposal>(`/api/v1/freelancing/proposals/${id}/submit`, { method: "POST" });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      invalidateFreelancing(queryClient);
      toast.success("Proposal submitted successfully!");
    },
  });

  const copyText = () => {
    navigator.clipboard.writeText(letter);
    toast.success("Copied proposal to clipboard!");
  };

  /** Markdown around the selection, or at the caret; list and quote marks go on each selected line. */
  const applyFormat = (kind: Format) => {
    const el = letterRef.current;
    if (!el) return;
    const { selectionStart: from, selectionEnd: to, value } = el;
    const picked = value.slice(from, to);
    let next: string;
    let caretFrom: number;
    let caretTo: number;

    const wrap = (open: string, close: string, fallback: string) => {
      const inner = picked || fallback;
      next = value.slice(0, from) + open + inner + close + value.slice(to);
      caretFrom = from + open.length;
      caretTo = caretFrom + inner.length;
    };
    const prefixLines = (mark: (n: number) => string) => {
      const start = value.lastIndexOf("\n", from - 1) + 1;
      const endAt = value.indexOf("\n", to);
      const end = endAt === -1 ? value.length : endAt;
      const block = value
        .slice(start, end)
        .split("\n")
        .map((line, i) => mark(i + 1) + line)
        .join("\n");
      next = value.slice(0, start) + block + value.slice(end);
      caretFrom = start;
      caretTo = start + block.length;
    };

    switch (kind) {
      case "bold":
        wrap("**", "**", "bold text");
        break;
      case "italic":
        wrap("*", "*", "italic text");
        break;
      case "strike":
        wrap("~~", "~~", "struck text");
        break;
      case "code":
        wrap("`", "`", "code");
        break;
      case "link":
        wrap("[", "](https://)", "link text");
        break;
      case "bullets":
        prefixLines(() => "- ");
        break;
      case "numbers":
        prefixLines((n) => `${n}. `);
        break;
      case "quote":
        prefixLines(() => "> ");
        break;
    }

    setLetter(next!);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caretFrom, caretTo);
    });
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

  return (
    <div className="space-y-3">
      <PageHero
        title="Proposal"
        back="/freelancing/proposals"
        stats={stats}
        badge={<Badge variant={dirty ? "warning" : "secondary"}>{dirty ? "Unsaved" : `Saved ${timeAgo(data.updated_at)}`}</Badge>}
        actions={
          <>
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Save />}
              Save draft
            </Button>
            <Button variant="brand" onClick={() => submit.mutate()} disabled={submit.isPending || !letter.trim()}>
              {submit.isPending ? <Spinner /> : <Send />}
              Submit proposal
            </Button>
          </>
        }
      />

      {(save.error || submit.error) && (
        <ErrorAlert>{((save.error ?? submit.error) as Error).message}</ErrorAlert>
      )}

      {(generation.state.running || generation.state.error) && (
        <GenerationProgress state={generation.state} />
      )}

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
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

              <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
                {TOOLBAR.map((group, i) => (
                  <div key={i} className="flex items-center gap-0.5">
                    <span className="bg-border mx-1.5 h-4 w-px" aria-hidden />
                    {group.map(({ format: kind, label, icon: Icon }) => (
                      <button
                        key={kind}
                        type="button"
                        aria-label={label}
                        title={label}
                        disabled={activeEditorTab !== "write"}
                        onClick={() => applyFormat(kind)}
                        className="text-foreground/75 hover:bg-muted focus-visible:ring-ring/40 grid size-7 place-items-center rounded outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Icon className="size-3.5" />
                      </button>
                    ))}
                  </div>
                ))}
              </div>

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
                aria-label="Cover letter"
                value={letter}
                onChange={(e) => {
                  setLetter(e.target.value);
                  setDirty(true);
                }}
                placeholder="Write the cover letter."
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

        <aside className="min-w-0">
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
              <span className="text-muted-foreground">Current draft</span>
              <span className="truncate font-medium">{describeEngine(data.engine_version)}</span>
            </section>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
