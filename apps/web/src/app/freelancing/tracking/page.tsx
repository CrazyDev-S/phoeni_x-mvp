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
import { Panel } from "@/components/panel";
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
    <div className="space-y-3">
      <PageHero
        title="Pipeline"
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

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="board" className="gap-1.5">
              <LayoutGrid />
              Board
            </TabsTrigger>
            <TabsTrigger value="list" className="gap-1.5">
              <List />
              List
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-64">
          <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search opportunities"
            aria-label="Search opportunities"
            className="pl-8"
          />
        </div>

        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger size="sm" aria-label="Stage" className="w-40">
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

        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch checked={showClosed} onCheckedChange={setShowClosed} size="sm" />
          Show closed
        </label>
      </div>

      {error && <ErrorAlert>{(error as Error).message}</ErrorAlert>}

      {isLoading ? (
        <Panel className="divide-y">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex h-9 items-center px-3">
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ))}
        </Panel>
      ) : !rows.length ? (
        <Panel>
          <EmptyState
            icon={<Users />}
            title={data?.length ? "Nothing at this stage" : "Nothing tracked yet"}
            action={
              !data?.length ? (
                <Button asChild size="sm">
                  <Link href="/freelancing/jobs">Find jobs</Link>
                </Button>
              ) : undefined
            }
          />
        </Panel>
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
