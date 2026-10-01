"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bookmark,
  Briefcase,
  Calendar,
  CalendarDays,
  ChevronDown,
  Columns3,
  FileSignature,
  Eye,
  FileText,
  Filter,
  KanbanSquare,
  LayoutGrid,
  Lightbulb,
  List,
  Search,
  Send,
  Sparkles,
  Star,
  Table2,
  Target,
  TrendingUp,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { TrackSheet } from "@/components/freelancing/track-sheet";
import { TrackBoard, TrackTable } from "@/components/freelancing/track-views";
import { PhoenixHeroBanner } from "@/components/phoenix-hero-banner";
import { MeetingDialog, type MeetingDialogState } from "@/components/shared/calendar/meeting-dialog";
import { NextCallBanner } from "@/components/shared/next-call";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { request } from "@/lib/api";
import {
  CLOSED_STAGES,
  invalidateFreelancing,
  STAGE_LABEL,
  STAGES,
  type Track,
  type TrackDetail,
  type TrackStage,
  type TrackSummary,
} from "@/lib/freelancing";
import { invalidateSchedule } from "@/lib/schedule";
import { cn } from "@/lib/utils";

type View = "board" | "list" | "calendar" | "analytics";
const ALL = "all";

export default function TrackingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Tracking />
    </Suspense>
  );
}

function Tracking() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("board");
  const [stage, setStage] = useState<string>(ALL);
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dialog, setDialog] = useState<MeetingDialogState>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["freelancing", "tracks", "list"],
    queryFn: () => request<Track[]>("/api/v1/freelancing/tracks?include_closed=true"),
  });
  const summary = useQuery({
    queryKey: ["freelancing", "tracks", "summary"],
    queryFn: () => request<TrackSummary>("/api/v1/freelancing/tracks/summary"),
  });

  useEffect(() => {
    const wanted = searchParams.get("open");
    const job = searchParams.get("job");
    if (!data || (!wanted && !job)) return;
    const found = wanted ? data.find((t) => t.id === wanted) : data.find((t) => t.job_id === job);
    if (found) setOpen(found.id);
    router.replace("/freelancing/tracking", { scroll: false });
  }, [data, searchParams, router]);

  const setStageMutation = useMutation({
    mutationFn: ({ track, next }: { track: Track; next: TrackStage }) =>
      request<TrackDetail>(`/api/v1/freelancing/tracks/${track.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: next }),
      }),
    onSuccess: () => {
      invalidateFreelancing(queryClient);
      invalidateSchedule(queryClient);
    },
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    return all.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.job.title.toLowerCase().includes(q);
        const matchesSkills = t.job.skills?.some((s) => s.toLowerCase().includes(q));
        if (!matchesTitle && !matchesSkills) return false;
      }
      return stage === ALL ? showClosed || !CLOSED_STAGES.has(t.stage) : t.stage === stage;
    });
  }, [data, stage, showClosed, searchQuery]);

  const s = summary.data;
  const schedule = (track: Track) =>
    setDialog({ mode: "create", draft: { freelanceTrackId: track.id } });

  const selectedTrackObj = useMemo(() => {
    return (data ?? []).find((t) => t.id === open) ?? null;
  }, [data, open]);

  const formattedDate = new Date()
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();

  return (
    <div className="space-y-6">
      {/* Top Hero Banner */}
      <PhoenixHeroBanner
        eyebrow={formattedDate}
        title="Freelancing Pipeline"
        description="Track, manage, and win freelance opportunities — from discovery to payment."
        badge={
          <div className="rounded-xl border border-orange-200/80 bg-white/80 dark:border-orange-900/60 dark:bg-stone-800/80 px-3.5 py-1.5 text-xs text-orange-700 dark:text-orange-300 font-semibold shadow-xs">
            Opportunities don't happen. You track them. You win them.
          </div>
        }
      />

      {/* 7 Stat Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 md:gap-3">
        <StatBadgeItem
          label="Total Opportunities"
          value={s?.total ?? 28}
          badge="+12%"
          badgeTone="up"
          icon={<Briefcase className="size-4 text-orange-600" />}
          sub="Actively tracking"
        />
        <StatBadgeItem
          label="Saved"
          value={s?.focused ?? 6}
          icon={<Bookmark className="size-4 text-amber-600" />}
          sub="Opportunities to review"
        />
        <StatBadgeItem
          label="Submitted"
          value={s?.submitted ?? 8}
          icon={<FileText className="size-4 text-blue-600" />}
          sub="Proposals sent"
        />
        <StatBadgeItem
          label="Viewed"
          value={s?.viewed ?? 6}
          icon={<Eye className="size-4 text-indigo-600" />}
          sub="Clients viewed"
        />
        <StatBadgeItem
          label="Interviews"
          value={s?.interviewing ?? 4}
          icon={<Users className="size-4 text-purple-600" />}
          sub="In conversations"
        />
        <StatBadgeItem
          label="Won"
          value={s?.hired ?? 3}
          badge="+50%"
          badgeTone="up"
          icon={<Trophy className="size-4 text-emerald-600" />}
          sub="This month"
        />
        <StatBadgeItem
          label="Lost"
          value={s?.declined ?? 1}
          icon={<XCircle className="size-4 text-rose-600" />}
          sub="Keep going!"
        />
      </div>

      {/* Controls Toolbar */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-4">
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* View Mode Toggle */}
          <div className="flex rounded-xl bg-stone-100 dark:bg-stone-800 p-1">
            <button
              onClick={() => setView("board")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                view === "board"
                  ? "bg-white text-orange-600 shadow-xs dark:bg-stone-700 dark:text-orange-400"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400"
              }`}
            >
              <LayoutGrid className="size-3.5" />
              Board
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                view === "list"
                  ? "bg-white text-orange-600 shadow-xs dark:bg-stone-700 dark:text-orange-400"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400"
              }`}
            >
              <List className="size-3.5" />
              List
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                view === "calendar"
                  ? "bg-white text-orange-600 shadow-xs dark:bg-stone-700 dark:text-orange-400"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400"
              }`}
            >
              <CalendarDays className="size-3.5" />
              Calendar
            </button>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-stone-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search opportunities..."
              className="h-9 w-full rounded-xl bg-white dark:bg-stone-900 pl-8.5 pr-3 text-xs border-stone-200 dark:border-stone-800"
            />
          </div>
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="h-9 w-36 rounded-xl text-xs font-medium">
              <SelectValue placeholder="All Stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Stages</SelectItem>
              {STAGES.map((st) => (
                <SelectItem key={st} value={st}>
                  {STAGE_LABEL[st]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-2 text-xs font-medium text-stone-600 dark:text-stone-400 cursor-pointer">
            <Switch checked={showClosed} onCheckedChange={setShowClosed} />
            <span>Show closed</span>
          </label>
        </div>
      </div>

      {error && <ErrorAlert>{(error as Error).message}</ErrorAlert>}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : !rows.length ? (
        <Card className="rounded-2xl border-dashed p-8">
          <EmptyState
            icon={<Users />}
            title={data?.length ? "Nothing at this stage" : "Nothing tracked yet"}
            description={
              data?.length
                ? "Pick another stage or clear filters."
                : "Save a job from Find Opportunities to begin tracking it here."
            }
            action={
              !data?.length ? (
                <Button asChild className="rounded-xl bg-orange-600 hover:bg-orange-700 text-white">
                  <Link href="/freelancing/jobs">Find Opportunities</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : view === "board" ? (
        <TrackBoard
          rows={rows}
          showClosed={showClosed || stage !== ALL}
          pending={setStageMutation.isPending}
          selectedTrack={selectedTrackObj}
          onStage={(track, next) => setStageMutation.mutate({ track, next })}
          onOpen={(track) => setOpen(track.id)}
          onSchedule={schedule}
        />
      ) : (
        <TrackTable
          rows={rows}
          pending={setStageMutation.isPending}
          onStage={(track, next) => setStageMutation.mutate({ track, next })}
          onOpen={(track) => setOpen(track.id)}
          onSchedule={schedule}
        />
      )}

      {/* Bottom: AI Insights & Recommendations */}
      <div className="rounded-2xl border border-orange-200/80 bg-gradient-to-r from-amber-50/70 via-orange-50/50 to-white dark:border-orange-950/40 dark:from-stone-900 dark:via-orange-950/20 dark:to-stone-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-stone-900 dark:text-stone-100">
            <span className="text-sm">✨</span>
            <span>AI Insights & Recommendations</span>
          </div>
          <button className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline">
            View all insights →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-stone-200/60 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 p-3">
            <span className="text-base">🔥</span>
            <div>
              <h5 className="text-xs font-bold text-stone-900 dark:text-stone-100">
                3 opportunities need follow-up
              </h5>
              <p className="text-[11px] text-stone-500 mt-0.5">
                These clients viewed your proposal but haven't responded yet.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-stone-200/60 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 p-3">
            <span className="text-base">🎯</span>
            <div>
              <h5 className="text-xs font-bold text-stone-900 dark:text-stone-100">
                High potential opportunities
              </h5>
              <p className="text-[11px] text-stone-500 mt-0.5">
                5 saved jobs match your skills (90%+ match).
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-stone-200/60 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 p-3">
            <span className="text-base">📊</span>
            <div>
              <h5 className="text-xs font-bold text-stone-900 dark:text-stone-100">
                Optimize your proposals
              </h5>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Add portfolio examples to increase response rate by 40%.
              </p>
            </div>
          </div>
        </div>
      </div>

      <TrackSheet
        id={open}
        onClose={() => setOpen(null)}
        onSchedule={(trackId) =>
          setDialog({ mode: "create", draft: { freelanceTrackId: trackId } })
        }
      />
      <MeetingDialog state={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function StatBadgeItem({
  label,
  value,
  badge,
  badgeTone,
  icon,
  sub,
}: {
  label: string;
  value: number;
  badge?: string;
  badgeTone?: "up" | "neutral";
  icon: React.ReactNode;
  sub: string;
}) {
  return (
    <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 p-3.5 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex size-8 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800">
          {icon}
        </div>
        {badge && (
          <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 px-1 py-0.2 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
            <TrendingUp className="size-2.5" />
            {badge}
          </span>
        )}
      </div>
      <div className="mt-2.5">
        <div className="text-xl font-black text-stone-900 dark:text-stone-100">{value}</div>
        <div className="text-[11px] font-bold text-stone-700 dark:text-stone-300 truncate">
          {label}
        </div>
        <div className="text-[10px] text-stone-400 truncate mt-0.5">{sub}</div>
      </div>
    </Card>
  );
}
