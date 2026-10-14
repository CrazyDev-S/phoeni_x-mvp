"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, List, Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { TrackSheet } from "@/components/freelancing/track-sheet";
import { TrackBoard, TrackTable } from "@/components/freelancing/track-views";
import { PageHero } from "@/components/page-hero";
import { MeetingDialog, type MeetingDialogState } from "@/components/shared/calendar/meeting-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type View = "board" | "list";
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
  const selectedTrackObj = useMemo(() => {
    return (data ?? []).find((t) => t.id === open) ?? null;
  }, [data, open]);

  return (
    <div className="space-y-7">
      <PageHero
        title="Pipeline"
        description="Every bid you are tracking, from the day you save it to the day it pays."
        stats={
          s
            ? [
                { value: s.total, label: "Tracking" },
                { value: s.submitted, label: "Submitted" },
                { value: s.interviewing, label: "Interviewing" },
                { value: s.hired, label: "Won" },
              ]
            : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="board">
              <LayoutGrid />
              Board
            </TabsTrigger>
            <TabsTrigger value="list">
              <List />
              List
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-80">
          <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-5 size-[17px] -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search opportunities…"
            aria-label="Search opportunities"
            className="bg-card/70 h-11 rounded-full pr-5 pl-12 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger aria-label="Stage" className="bg-card/70 h-11 min-w-44 rounded-full pr-4 pl-5 text-sm font-semibold">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All stages</SelectItem>
              {STAGES.map((st) => (
                <SelectItem key={st} value={st}>
                  {STAGE_LABEL[st]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="bg-card/70 flex h-11 cursor-pointer items-center gap-2.5 rounded-full pr-1.5 pl-4 text-sm font-semibold">
            Show closed
            <Switch checked={showClosed} onCheckedChange={setShowClosed} />
          </label>
        </div>
      </div>

      {error && <ErrorAlert>{(error as Error).message}</ErrorAlert>}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-[2rem]" />
          ))}
        </div>
      ) : !rows.length ? (
        <Card tone="soft" className="p-8">
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
                <Button asChild>
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
          selectedTrack={selectedTrackObj}
          onOpen={(track) => setOpen(track.id)}
        />
      ) : (
        <TrackTable
          rows={rows}
          pending={setStageMutation.isPending}
          onStage={(track, next) => setStageMutation.mutate({ track, next })}
          onOpen={(track) => setOpen(track.id)}
        />
      )}

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
