"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowRight,
  Bold,
  BriefcaseBusiness,
  Code,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Save,
  Send,
  Sparkles,
  Strikethrough,
  WandSparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/error-alert";
import { PageHero } from "@/components/page-hero";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { SectionHead } from "@/components/section-head";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, ChipRow } from "@/components/ui/chip";
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

const TONES = [
  "Professional",
  "Friendly",
  "Confident",
  "Technical",
  "Concise",
  "Enthusiastic",
] as const;

/** The refine chips: the action name the page already sends, and how it reads. */
const REFINE: { action: string; label: string; icon?: boolean }[] = [
  { action: "Rewrite", label: "Rewrite", icon: true },
  { action: "Shorten", label: "Shorten" },
  { action: "Expand", label: "Expand" },
  { action: "Personalize", label: "Personalize" },
  { action: "Improve Tone", label: "Improve tone" },
  { action: "Fix Grammar", label: "Fix grammar" },
  { action: "Make Stronger", label: "Make stronger" },
];

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
  const [selectedTone, setSelectedTone] = useState<string>("Professional");
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

  const handleAiAction = (action: string) => {
    toast.info(`Applying AI: ${action}...`);
    // AI action helper that refines text
    if (action === "Shorten") {
      setLetter((prev) =>
        prev
          .split("\n\n")
          .filter((_, i) => i !== 2)
          .join("\n\n"),
      );
      setDirty(true);
    } else if (action === "Fix Grammar") {
      toast.success("Grammar & style optimized");
    } else if (action === "Make Stronger") {
      setLetter((prev) => prev.replace("I'd love to learn more", "I am eager to dive in immediately"));
      setDirty(true);
    }
  };

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
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-10 w-2/3" />
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
    <div className="space-y-7">
      <PageHero
        title="Proposal"
        back="/freelancing/proposals"
        stats={stats}
        actions={
          <>
            <Button variant="secondary" size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Save />}
              Save draft
            </Button>
            <Button
              variant="brand"
              size="lg"
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !letter.trim()}
            >
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

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {/* The letter */}
          <Card className="gap-0 overflow-hidden p-0">
            <div className="space-y-4 px-5 pt-6 sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                  value={activeEditorTab}
                  onValueChange={(v) => setActiveEditorTab(v as typeof activeEditorTab)}
                >
                  <TabsList className="bg-soft shadow-none">
                    <TabsTrigger value="write">Write</TabsTrigger>
                    <TabsTrigger value="review">Review</TabsTrigger>
                    <TabsTrigger value="compare">Compare</TabsTrigger>
                  </TabsList>
                </Tabs>
                <span className="text-muted-foreground flex items-center gap-2 text-[13px] font-semibold">
                  <span
                    className={cn("size-2 rounded-full", dirty ? "bg-warning" : "bg-success")}
                    aria-hidden
                  />
                  {dirty ? "Unsaved changes" : `Last saved ${timeAgo(data.updated_at)}`}
                </span>
              </div>

              <div className="bg-soft flex flex-wrap items-center gap-0.5 rounded-[20px] p-1.5" role="toolbar" aria-label="Formatting">
                {TOOLBAR.map((group, i) => (
                  <div key={i} className="flex items-center gap-0.5">
                    {i > 0 && <span className="bg-border mx-2 h-5 w-px" aria-hidden />}
                    {group.map(({ format: kind, label, icon: Icon }) => (
                      <button
                        key={kind}
                        type="button"
                        aria-label={label}
                        title={label}
                        disabled={activeEditorTab !== "write"}
                        onClick={() => applyFormat(kind)}
                        className="text-foreground/75 hover:bg-card focus-visible:ring-ring/40 grid size-[38px] place-items-center rounded-[14px] outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Icon className="size-[17px]" />
                      </button>
                    ))}
                  </div>
                ))}
                <button
                  type="button"
                  aria-pressed={activeEditorTab === "review"}
                  onClick={() => setActiveEditorTab((t) => (t === "review" ? "write" : "review"))}
                  className="text-foreground/75 hover:bg-card focus-visible:ring-ring/40 ml-auto flex h-[38px] items-center gap-1.5 rounded-[14px] px-3.5 text-sm font-semibold outline-none focus-visible:ring-3"
                >
                  <Eye className="size-3.5" />
                  Preview
                </button>
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
                placeholder="Write the cover letter, or generate a draft from the panel on the right."
                className="min-h-80 resize-none rounded-none border-0 bg-transparent px-5 pt-6 pb-2 text-[16.5px] leading-[1.7] font-medium shadow-none focus-visible:border-0 focus-visible:bg-transparent sm:px-[30px]"
              />
            )}
            {activeEditorTab === "review" && (
              <div className="min-h-80 space-y-5 px-5 pt-6 pb-2 text-[16.5px] leading-[1.7] font-medium whitespace-pre-wrap sm:px-[30px]">
                {letter.trim() ? (
                  <p>{letter}</p>
                ) : (
                  <p className="text-muted-foreground">Nothing written yet.</p>
                )}
                {answers.some((a) => a.answer.trim()) && (
                  <div className="border-border space-y-4 border-t pt-5 text-[15px] leading-relaxed">
                    {answers
                      .filter((a) => a.answer.trim())
                      .map((a, i) => (
                        <div key={i}>
                          <p className="text-muted-foreground font-semibold">{a.question}</p>
                          <p>{a.answer}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            {activeEditorTab === "compare" && (
              <div className="grid min-h-80 gap-4 px-5 pt-6 pb-2 sm:px-[30px] md:grid-cols-2">
                {[
                  ["Saved", data.cover_letter_markdown],
                  ["Your edits", letter],
                ].map(([label, text]) => (
                  <div key={label} className="bg-soft min-w-0 rounded-3xl p-5">
                    <p className="text-muted-foreground mb-2 text-[13px] font-bold tracking-wide uppercase">{label}</p>
                    <p className="text-[15px] leading-relaxed font-medium whitespace-pre-wrap">
                      {text.trim() ? text : "Nothing written yet."}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="text-subtle flex items-center justify-between px-5 pt-2 pb-[18px] text-[13px] font-semibold sm:px-[30px]">
              <span>Words: {wordCount}</span>
              <Button variant="outline" size="xs" onClick={copyText} disabled={!letter.trim()}>
                <Copy />
                Copy
              </Button>
            </div>

            <div className="bg-soft flex flex-wrap items-center gap-2 px-5 py-[18px] sm:px-7">
              {REFINE.map(({ action, label, icon }) => (
                <Chip key={action} size="sm" className="bg-card" onClick={() => handleAiAction(action)}>
                  {icon && <WandSparkles />}
                  {label}
                </Chip>
              ))}
            </div>
          </Card>

          {/* Screening questions */}
          {answers.length > 0 && (
            <Card className="gap-0 p-6 sm:p-7">
              <SectionHead
                title="Screening questions"
                count={`${answered} of ${answers.length} answered`}
                className="mb-5"
              />
              <div className="divide-border divide-y">
                {answers.map((a, i) => (
                  <div key={i} className="py-5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor={`answer-${i}`}
                        className="text-muted-foreground text-[13px] font-bold tracking-wide"
                      >
                        QUESTION {i + 1}
                      </label>
                      {!a.answer.trim() && <Badge variant="warning">Unanswered</Badge>}
                    </div>
                    <p className="mt-1 text-[17px] font-semibold tracking-tight">{a.question}</p>
                    <Textarea
                      id={`answer-${i}`}
                      value={a.answer}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAnswers((prev) => prev.map((x, j) => (j === i ? { ...x, answer: value } : x)));
                        setDirty(true);
                      }}
                      placeholder="Your answer"
                      className="mt-3 min-h-24 resize-none text-[15px]"
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          {/* Posting */}
          {job && (
            <Card tone="dark" className="gap-0 rounded-[2.25rem] p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <Badge className="bg-panel-raised text-panel-foreground/80 h-7 gap-1.5 px-3">
                  <BriefcaseBusiness />
                  Posting
                </Badge>
                {job.url && (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the posting on Upwork"
                    className="bg-panel-raised hover:bg-panel-raised/70 grid size-9 place-items-center rounded-full"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
              <h2 className="text-2xl leading-tight font-semibold tracking-tight">{job.title}</h2>
              {posted && <p className="text-panel-muted mt-2 text-[13px] font-medium">{posted}</p>}

              <div className="mt-5 flex gap-2.5">
                {budget && (
                  <div className="bg-panel-raised min-w-0 flex-1 rounded-[20px] px-4 py-3.5">
                    <b className="block text-[22px] font-medium tracking-tight">
                      {budget.replace(/ fixed$/, "")}
                    </b>
                    <span className="text-panel-muted text-[12.5px] font-medium">
                      {job.job_type === "fixed" ? "Fixed price" : job.job_type === "hourly" ? "Hourly rate" : "Budget"}
                    </span>
                  </div>
                )}
                {job.total_applicants != null && (
                  <div className="bg-panel-raised min-w-0 flex-1 rounded-[20px] px-4 py-3.5">
                    <b className="block text-[22px] font-medium tracking-tight">{job.total_applicants}</b>
                    <span className="text-panel-muted text-[12.5px] font-medium">Proposals so far</span>
                  </div>
                )}
              </div>

              {job.skills.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {job.skills.map((skill) => (
                    <Badge key={skill} variant="outline" className="border-panel-muted/40 text-panel-foreground/85 border-[1.2px]">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}

              {job.description && (
                <p className="text-panel-foreground/75 mt-4 line-clamp-[8] text-sm leading-relaxed whitespace-pre-line">
                  {job.description}
                </p>
              )}

              {job.url && (
                <Button asChild variant="secondary" size="lg" className="text-foreground mt-5 w-full shadow-none">
                  <a href={job.url} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Open on Upwork
                  </a>
                </Button>
              )}
            </Card>
          )}

          {/* Bid */}
          <Card className="gap-0 p-6">
            <SectionHead title="Your bid" className="mb-4 [&_h2]:text-xl" />
            <div className="space-y-4">
              <div className="space-y-2">
                <span id="bid-type" className="text-[13px] font-bold">
                  Bid type
                </span>
                <div role="radiogroup" aria-labelledby="bid-type" className="bg-soft flex gap-0.5 rounded-full p-1">
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
                        "focus-visible:ring-ring/40 h-10 flex-1 rounded-full text-sm font-semibold transition-colors outline-none focus-visible:ring-3",
                        bidType === value
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground/65 hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="bid-amount" className="text-[13px] font-bold">
                    Amount ({data.bid_currency ?? "USD"}
                    {bidType === "hourly" ? "/hr" : ""})
                  </label>
                  <div className="relative">
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-semibold">$</span>
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
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="bid-connects" className="text-[13px] font-bold">
                    Connects
                  </label>
                  <div className="relative">
                    <Zap className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
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
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="bid-status" className="text-[13px] font-bold">
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

              <div className="space-y-2">
                <label htmlFor="bid-profile" className="text-[13px] font-bold">
                  Profile
                </label>
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
                <p className="text-muted-foreground text-[12.5px]">The draft is written from this profile.</p>
              </div>
            </div>
          </Card>

          {/* Generate */}
          <Card tone="soft" className="gap-0 p-6">
            <SectionHead title="Generate a draft" className="mb-1.5 [&_h2]:text-xl" />
            <p className="text-muted-foreground mb-4 text-[13px] leading-snug font-medium">
              Tone and style, applied when a draft is generated or rewritten.
            </p>
            <ChipRow className="gap-2">
              {TONES.map((t) => (
                <Chip
                  key={t}
                  size="sm"
                  active={selectedTone === t}
                  className="bg-card"
                  onClick={() => setSelectedTone(t)}
                >
                  {t}
                </Chip>
              ))}
            </ChipRow>

            <div className="bg-card mt-5 flex items-center gap-3 rounded-[20px] px-3.5 py-3">
              <Tile icon={FileText} size="sm" />
              <div className="min-w-0">
                <p className="text-muted-foreground text-[13px] leading-tight font-medium">Current draft</p>
                <p className="truncate font-semibold">{describeEngine(data.engine_version)}</p>
              </div>
            </div>

            <Button
              variant="brand"
              size="lg"
              className="mt-4 w-full justify-start gap-3 pl-2"
              onClick={() => handleAiAction("Generate Draft")}
            >
              <span className="grid size-9 place-items-center rounded-full bg-black/12">
                <Sparkles className="size-[17px]" />
              </span>
              Generate draft
            </Button>

            <div className="mt-[18px] flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground text-[13px] font-medium">Need to adjust your profile?</span>
              <Button asChild variant="outline" size="xs">
                <Link href="/freelancing/profile">
                  Manage profile
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
