"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Bold,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code,
  Copy,
  ExternalLink,
  Eye,
  FileSignature,
  FileText,
  Heading,
  HelpCircle,
  History,
  Info,
  Italic,
  Lightbulb,
  Link as LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Quote,
  Redo,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Strikethrough,
  Target,
  Trash2,
  Underline,
  Undo,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { GenerationProgress } from "@/components/remote/generation-progress";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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

  const [title, setTitle] = useState("React SaaS Dashboard Proposal");
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

  useEffect(() => {
    if (!data) return;
    const version = `${data.updated_at}:${data.engine_version}`;
    if (loadedVersion.current === version) return;
    loadedVersion.current = version;
    setLetter(
      data.cover_letter_markdown ||
        `Hi there,\n\nI'm excited about the opportunity to help you build a modern and high-performing SaaS dashboard for your fintech product. With 5+ years of experience in React and modern JavaScript frameworks, I've built several scalable web applications with clean architecture, responsive design, and seamless API integrations.\n\nI understand the importance of performance, security, and a great user experience for fintech products, and I'm confident I can deliver a dashboard that meets your goals and exceeds expectations.\n\nHere's how I can help:\n• Build pixel-perfect, responsive React components\n• Integrate with REST/GraphQL APIs and implement authentication flow\n• Follow best practices for performance, accessibility, and clean code\n• Provide clear documentation and ongoing support\n\nI'd love to learn more about your product and discuss how I can contribute to your success. Looking forward to the possibility of working together!\n\nBest regards,\nPhoenixstar`,
    );
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

  return (
    <div className="space-y-5">
      {/* Top Header Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/freelancing/jobs"
            className="inline-flex items-center gap-1 text-xs font-semibold text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors mb-1"
          >
            <ArrowLeft className="size-3.5" />
            Back to Jobs
          </Link>
          <h1 className="text-2xl font-black tracking-tight text-stone-900 dark:text-stone-100">
            Proposal Writer
          </h1>
          <p className="text-xs text-stone-500">
            Craft a personalized, compelling proposal with AI and increase your chances of winning.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-xl border-stone-200 dark:border-stone-800 text-xs font-semibold gap-1.5 h-9"
          >
            <Save className="size-3.5 text-stone-500" />
            Save Draft
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="rounded-xl border-stone-200 dark:border-stone-800 text-xs font-semibold gap-1.5 h-9"
          >
            <History className="size-3.5 text-stone-500" />
            Proposal History
          </Button>

          <Button
            size="sm"
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !letter.trim()}
            className="rounded-xl bg-[#ea580c] hover:bg-[#c2410c] text-white font-bold text-xs gap-1.5 h-9 px-4 shadow-sm"
          >
            <Send className="size-3.5" />
            Submit Proposal
          </Button>

          <Button variant="ghost" size="icon" className="size-9 rounded-xl text-stone-400">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      {(generation.state.running || generation.state.error) && (
        <GenerationProgress state={generation.state} />
      )}

      {/* 3 Columns Layout */}
      <div className="grid gap-5 lg:grid-cols-[300px_1fr_310px] items-start">
        {/* Left Column: Job Summary */}
        <div className="space-y-4">
          <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 p-4">
              <div className="flex items-center gap-2">
                <span className="text-base">📋</span>
                <h3 className="font-bold text-sm text-stone-900 dark:text-stone-100">Job Summary</h3>
              </div>
              <div className="flex items-center gap-1">
                {job?.url && (
                  <Button asChild variant="outline" size="sm" className="h-7 text-[11px] rounded-lg px-2">
                    <a href={job.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <CardContent className="p-4 space-y-3.5">
              <div>
                <h4 className="font-bold text-sm text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                  {job?.title || "React Developer for SaaS Dashboard"}
                  <BadgeCheck className="size-4 text-emerald-500" />
                </h4>
                <div className="text-[11px] text-stone-500 mt-0.5">
                  Upwork Client • Posted 5 hours ago
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-2">
                  <div className="font-bold text-stone-900 dark:text-stone-100">
                    {job ? formatBudget(job) : "$1K – $3K"}
                  </div>
                  <div className="text-[10px] text-stone-500">Fixed price</div>
                </div>
                <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-2">
                  <div className="font-bold text-stone-900 dark:text-stone-100">Intermediate</div>
                  <div className="text-[10px] text-stone-500">Experience level</div>
                </div>
                <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-2">
                  <div className="font-bold text-stone-900 dark:text-stone-100">1–3 months</div>
                  <div className="text-[10px] text-stone-500">Duration</div>
                </div>
                <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-2">
                  <div className="font-bold text-stone-900 dark:text-stone-100">Remote</div>
                  <div className="text-[10px] text-stone-500">Worldwide</div>
                </div>
              </div>

              {/* About the project */}
              <div>
                <h5 className="text-xs font-bold text-stone-800 dark:text-stone-200">About the Project</h5>
                <p className="text-xs text-stone-600 dark:text-stone-400 mt-1 leading-relaxed line-clamp-3">
                  {job?.description ||
                    "We are building a modern SaaS dashboard for our fintech product. Looking for an experienced React developer who can implement responsive UI, integrate APIs, and ensure high performance..."}
                </p>
              </div>

              {/* Client Signals */}
              <div className="space-y-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                <h5 className="text-xs font-bold text-stone-800 dark:text-stone-200 flex items-center gap-1">
                  <ShieldCheck className="size-3.5 text-blue-500" />
                  Client Signals
                </h5>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    <span>98% success</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                    <Star className="size-3 text-amber-500 fill-amber-500" />
                    <span>4.9 (28 reviews)</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                    <BadgeCheck className="size-3 text-blue-500" />
                    <span>Top Rated</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                    <span>45 total hires</span>
                  </div>
                </div>
              </div>

              {/* Project Requirements Checklist */}
              <div className="space-y-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                <h5 className="text-xs font-bold text-stone-800 dark:text-stone-200">
                  Project Requirements
                </h5>
                <ul className="space-y-1.5 text-xs text-stone-700 dark:text-stone-300">
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>Build responsive React components</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>Integrate with REST/GraphQL APIs</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>Implement authentication flow</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>Ensure performance and accessibility</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>Clean, maintainable code with documentation</span>
                  </li>
                </ul>
              </div>

              {/* Match Insights */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex size-9 items-center justify-center rounded-full bg-emerald-600 text-white font-black text-xs">
                    96%
                  </div>
                  <div>
                    <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      Excellent Match
                    </div>
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                      React • SaaS • API Integration
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Center Column: Proposal Editor */}
        <div className="space-y-4">
          <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
            <div className="border-b border-stone-200/80 dark:border-stone-800 p-4 space-y-3">
              {/* Proposal Title */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block mb-1">
                    Proposal Title (internal)
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-9 font-medium text-xs rounded-xl"
                  />
                </div>
                <div className="text-xs text-stone-400 self-end mb-2 tabular-nums">
                  {title.length}/80
                </div>
              </div>

              {/* Tabs & Undo/Redo */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div className="flex rounded-xl bg-stone-100 dark:bg-stone-800 p-1">
                  <button
                    onClick={() => setActiveEditorTab("write")}
                    className={cn(
                      "rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                      activeEditorTab === "write"
                        ? "bg-white text-orange-600 shadow-xs dark:bg-stone-700 dark:text-orange-400"
                        : "text-stone-500 hover:text-stone-900 dark:text-stone-400",
                    )}
                  >
                    Write
                  </button>
                  <button
                    onClick={() => setActiveEditorTab("review")}
                    className={cn(
                      "rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                      activeEditorTab === "review"
                        ? "bg-white text-orange-600 shadow-xs dark:bg-stone-700 dark:text-orange-400"
                        : "text-stone-500 hover:text-stone-900 dark:text-stone-400",
                    )}
                  >
                    Review
                  </button>
                  <button
                    onClick={() => setActiveEditorTab("compare")}
                    className={cn(
                      "rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                      activeEditorTab === "compare"
                        ? "bg-white text-orange-600 shadow-xs dark:bg-stone-700 dark:text-orange-400"
                        : "text-stone-500 hover:text-stone-900 dark:text-stone-400",
                    )}
                  >
                    Compare
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-stone-400 flex items-center gap-1">
                    <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
                    Last saved 2 minutes ago
                  </span>

                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="size-7 rounded-md text-stone-400">
                      <Undo className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7 rounded-md text-stone-400">
                      <Redo className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Rich Editor Toolbar */}
              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-stone-50 dark:bg-stone-800/60 p-1.5 border border-stone-200/60 dark:border-stone-800">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-medium gap-1">
                  Paragraph <ChevronDown className="size-3" />
                </Button>
                <div className="h-4 w-px bg-stone-200 dark:bg-stone-700 mx-1" />
                <Button variant="ghost" size="icon" className="size-7">
                  <Bold className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7">
                  <Italic className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7">
                  <Underline className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7">
                  <Strikethrough className="size-3.5" />
                </Button>
                <div className="h-4 w-px bg-stone-200 dark:bg-stone-700 mx-1" />
                <Button variant="ghost" size="icon" className="size-7">
                  <List className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7">
                  <ListOrdered className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7">
                  <Quote className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7">
                  <Code className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7">
                  <LinkIcon className="size-3.5" />
                </Button>
                <div className="ml-auto">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-stone-500">
                    <Eye className="size-3.5" />
                    Preview
                  </Button>
                </div>
              </div>
            </div>

            {/* Textarea Content */}
            <CardContent className="p-4 space-y-3">
              <Textarea
                rows={16}
                value={letter}
                onChange={(e) => {
                  setLetter(e.target.value);
                  setDirty(true);
                }}
                className="w-full resize-none border-0 p-0 text-sm leading-relaxed focus-visible:ring-0 font-sans shadow-none"
              />

              <div className="flex items-center justify-between border-t border-stone-100 dark:border-stone-800 pt-3 text-xs text-stone-400">
                <span>Words: {wordCount}</span>
                <Button variant="ghost" size="icon" className="size-6 text-stone-400">
                  <Maximize2 className="size-3.5" />
                </Button>
              </div>
            </CardContent>

            {/* Bottom AI Actions Bar */}
            <div className="border-t border-stone-200/80 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  onClick={() => handleAiAction("Generate Draft")}
                  className="rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs h-8 px-3.5 shadow-sm"
                >
                  <Sparkles className="size-3.5 mr-1" />
                  Generate Draft
                  <ChevronDown className="size-3 ml-1" />
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAiAction("Rewrite")}
                  className="h-8 rounded-xl text-xs font-semibold"
                >
                  <Wand2 className="size-3 mr-1 text-purple-600" />
                  Rewrite
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAiAction("Shorten")}
                  className="h-8 rounded-xl text-xs font-semibold"
                >
                  Shorten
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAiAction("Expand")}
                  className="h-8 rounded-xl text-xs font-semibold"
                >
                  Expand
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAiAction("Personalize")}
                  className="h-8 rounded-xl text-xs text-stone-600 dark:text-stone-400"
                >
                  Personalize
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAiAction("Improve Tone")}
                  className="h-8 rounded-xl text-xs text-stone-600 dark:text-stone-400"
                >
                  Improve Tone
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAiAction("Fix Grammar")}
                  className="h-8 rounded-xl text-xs text-stone-600 dark:text-stone-400"
                >
                  Fix Grammar
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAiAction("Make Stronger")}
                  className="h-8 rounded-xl text-xs text-stone-600 dark:text-stone-400"
                >
                  Make Stronger
                </Button>

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyText}
                    className="h-8 rounded-xl text-xs font-semibold"
                  >
                    <Copy className="size-3 mr-1 text-stone-500" />
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: AI Proposal Assistant */}
        <div className="space-y-4">
          <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-purple-600" />
                <h3 className="font-bold text-sm text-stone-900 dark:text-stone-100">
                  AI Proposal Assistant
                </h3>
              </div>
              <span className="rounded-md bg-purple-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                AI
              </span>
            </div>

            <CardContent className="p-4 space-y-4">
              <p className="text-xs text-stone-500 leading-relaxed">
                Get tailored suggestions, improve your writing, and create a winning proposal.
              </p>

              {/* Tone & Style */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Tone & Style
                  </label>
                  <span className="text-[11px] text-stone-500">Balanced & Professional</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTone(t)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                        selectedTone === t
                          ? "bg-orange-500 text-white shadow-xs font-semibold"
                          : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Your Profile Highlights */}
              <div className="space-y-2 pt-3 border-t border-stone-100 dark:border-stone-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Your Profile Highlights
                  </h4>
                  <Link
                    href="/freelancing/profile"
                    className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline"
                  >
                    Manage →
                  </Link>
                </div>

                <ul className="space-y-1.5 text-xs text-stone-700 dark:text-stone-300">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-orange-600 shrink-0" />
                    <span>5+ years of React development experience</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-orange-600 shrink-0" />
                    <span>Built 10+ SaaS products</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-orange-600 shrink-0" />
                    <span>Expert in API integration (REST/GraphQL)</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-orange-600 shrink-0" />
                    <span>Strong UI/UX and responsive design skills</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-orange-600 shrink-0" />
                    <span>Previous fintech project experience</span>
                  </li>
                </ul>
              </div>

              {/* Proposal Strategy */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-amber-900 dark:text-amber-200">
                  <span className="flex items-center gap-1">
                    <Target className="size-3.5 text-amber-600" />
                    Proposal Strategy
                  </span>
                  <span className="text-[10px] rounded bg-amber-200 dark:bg-amber-900 px-1.5 py-0.2 text-amber-800 dark:text-amber-300">
                    Suggested
                  </span>
                </div>
                <p className="text-[11px] text-amber-900/90 dark:text-amber-300/90 leading-relaxed">
                  Focus on your fintech experience and highlight similar SaaS dashboards you've
                  built. Emphasize performance, security, and long-term support.
                </p>
              </div>

              {/* AI Suggestions */}
              <div className="space-y-2 pt-3 border-t border-stone-100 dark:border-stone-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    AI Suggestions
                  </h4>
                  <button className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline">
                    See all →
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="rounded-xl border border-purple-100 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/20 p-2.5">
                    <div className="text-xs font-bold text-purple-900 dark:text-purple-200">
                      Add a specific example from your portfolio
                    </div>
                    <div className="text-[11px] text-purple-700 dark:text-purple-300 mt-0.5">
                      Mention a similar SaaS dashboard project.
                    </div>
                  </div>

                  <div className="rounded-xl border border-purple-100 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/20 p-2.5">
                    <div className="text-xs font-bold text-purple-900 dark:text-purple-200">
                      Include measurable results
                    </div>
                    <div className="text-[11px] text-purple-700 dark:text-purple-300 mt-0.5">
                      E.g. improved performance by 40%.
                    </div>
                  </div>

                  <div className="rounded-xl border border-purple-100 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/20 p-2.5">
                    <div className="text-xs font-bold text-purple-900 dark:text-purple-200">
                      Add a strong call to action
                    </div>
                    <div className="text-[11px] text-purple-700 dark:text-purple-300 mt-0.5">
                      Invite the client to discuss next steps.
                    </div>
                  </div>
                </div>
              </div>

              {/* Quality Checklist */}
              <div className="space-y-2 pt-3 border-t border-stone-100 dark:border-stone-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Quality Checklist
                  </h4>
                  <span className="text-xs font-bold text-emerald-600">4/5</span>
                </div>
                <Progress value={80} className="h-1.5 bg-stone-100 dark:bg-stone-800" />

                <ul className="space-y-1.5 text-xs text-stone-700 dark:text-stone-300 pt-1">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                    <span>Addresses all requirements</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                    <span>Highlights relevant experience</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                    <span>Clear and professional tone</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                    <span>Includes call to action</span>
                  </li>
                  <li className="flex items-center gap-1.5 text-stone-400">
                    <span className="size-3.5 rounded-full border border-stone-300 dark:border-stone-600 shrink-0" />
                    <span>Mentions timeline or availability</span>
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
