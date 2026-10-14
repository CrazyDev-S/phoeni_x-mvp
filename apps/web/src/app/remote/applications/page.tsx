"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, CalendarPlus, Columns3, Search, Table2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ApplicationSheet } from "@/components/remote/applications/application-sheet";
import { ApplicationBoard } from "@/components/remote/applications/board";
import { PipelineTable } from "@/components/remote/applications/pipeline-table";
import {
  STATUS_LABEL,
  STATUSES,
  type ApplicationRow,
  type StageUpdated,
} from "@/components/remote/applications/shared";
import {
  MeetingDialog,
  type MeetingDialogState,
} from "@/components/shared/calendar/meeting-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHero } from "@/components/page-hero";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { request } from "@/lib/api";
import { invalidateSchedule } from "@/lib/schedule";

const ALL = "all";

type View = "table" | "board";

interface NextStep {
  company: string;
  stageId: string;
  name: string;
  duration: number | null;
}

export default function ApplicationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(ALL);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("table");
  const [open, setOpen] = useState<ApplicationRow | null>(null);
  const [dialog, setDialog] = useState<MeetingDialogState>(null);
  const [nextStep, setNextStep] = useState<NextStep | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["applications", filter],
    queryFn: () =>
      request<{ items: ApplicationRow[]; total: number }>(
        `/api/v1/remote/applications${filter === ALL ? "" : `?status=${filter}`}`,
      ),
  });

  const setStage = useMutation({
    mutationFn: ({ stageId, status }: { row: ApplicationRow; stageId: string; status: string }) =>
      request<StageUpdated>(`/api/v1/remote/stages/${stageId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (res, { row }) => {
      invalidateSchedule(queryClient);
      const next = res.suggested_next_stage;
      setNextStep(
        next?.stage_id && !next.already_scheduled
          ? {
              company: row.company_name,
              stageId: next.stage_id,
              name: next.name ?? "the next step",
              duration: next.suggested_duration_min,
            }
          : null,
      );
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      request(`/api/v1/remote/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    // The board re-sorts on success; an optimistic move would make a failed
    // write look like it landed in the new column.
    onSuccess: () => invalidateSchedule(queryClient),
  });

  const counts = useMemo(() => {
    const items = data?.items ?? [];
    const has = (...statuses: string[]) => items.filter((r) => statuses.includes(r.status)).length;
    return {
      open: has("saved", "applied", "in_process"),
      inProcess: has("in_process"),
      offers: has("offer", "hired"),
      closed: has("rejected", "withdrawn", "ghosted"),
    };
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!needle) return items;
    return items.filter((r) =>
      `${r.company_name} ${r.role_title} ${r.location ?? ""}`.toLowerCase().includes(needle),
    );
  }, [data, q]);

  const pending = setStage.isPending || setStatus.isPending;

  const stats = isLoading
    ? undefined
    : [
        { value: counts.open, label: "In the pipeline" },
        { value: counts.inProcess, label: "In process" },
        { value: counts.offers, label: counts.offers === 1 ? "Offer" : "Offers" },
        { value: counts.closed, label: "Closed" },
      ];

  return (
    <div className="space-y-7">
      <PageHero
        title="Applications"
        stats={stats}
        actions={
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setDialog({ mode: "create", draft: {} })}
          >
            <CalendarPlus />
            Schedule
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-12">
            <TabsTrigger value="table" className="gap-2 px-5">
              <Table2 />
              Table
            </TabsTrigger>
            <TabsTrigger value="board" className="gap-2 px-5">
              <Columns3 />
              Board
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-[17px] -translate-y-1/2" />
          <Input
            placeholder="Search company, role or location…"
            aria-label="Search applications"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-card h-12 rounded-full pl-11"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger
            className="bg-card ml-auto h-12 w-44 rounded-full pl-5"
            aria-label="Filter by status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {nextStep && (
        <Alert>
          <CalendarPlus />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {nextStep.company}: passed. Next up is{" "}
              <strong className="text-foreground">{nextStep.name}</strong>.
            </span>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                setDialog({
                  mode: "create",
                  draft: {
                    stageId: nextStep.stageId,
                    duration: nextStep.duration ?? undefined,
                  },
                });
                setNextStep(null);
              }}
            >
              Schedule it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setNextStep(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-3xl" />
          ))}
        </div>
      ) : !rows.length ? (
        <Card className="py-0">
          <EmptyState
            icon={<Briefcase />}
            title={q || filter !== ALL ? "Nothing matches those filters" : "No applications yet"}
            description={
              q || filter !== ALL
                ? "Clear the search or pick a different status."
                : "Save one after tailoring a resume — from the portal or the extension."
            }
            action={
              !q && filter === ALL ? (
                <Button asChild>
                  <Link href="/remote/tailor">Tailor a resume</Link>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setFilter(ALL);
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : view === "board" ? (
        <ApplicationBoard
          rows={rows}
          pending={setStatus.isPending}
          onStatus={(id, status) => setStatus.mutate({ id, status })}
          onOpen={setOpen}
        />
      ) : (
        <PipelineTable
          rows={rows}
          pending={pending}
          activeId={open?.id}
          onOpen={setOpen}
          onStatus={(row, status) => setStatus.mutate({ id: row.id, status })}
          onStageStatus={(row, stage, status) =>
            setStage.mutate({ row, stageId: stage.id, status })
          }
          onSchedule={(_, stage) => setDialog({ mode: "create", draft: { stageId: stage.id } })}
          onEditMeeting={(row, stage, meeting) =>
            setDialog({
              mode: "edit",
              meeting: { ...meeting, company_name: row.company_name, stage_name: stage.name },
            })
          }
        />
      )}

      <ApplicationSheet
        id={open?.id ?? null}
        title={open?.company_name}
        onClose={() => setOpen(null)}
      />
      <MeetingDialog state={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
