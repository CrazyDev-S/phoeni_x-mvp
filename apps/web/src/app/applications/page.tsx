"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  Briefcase,
  CalendarPlus,
  Columns3,
  Search,
  Table2,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ApplicationSheet } from "@/components/applications/application-sheet";
import { ApplicationBoard } from "@/components/applications/board";
import { PipelineTable } from "@/components/applications/pipeline-table";
import {
  STATUS_LABEL,
  STATUSES,
  type ApplicationRow,
  type StageUpdated,
} from "@/components/applications/shared";
import { MeetingDialog, type MeetingDialogState } from "@/components/calendar/meeting-dialog";
import { EmptyState } from "@/components/empty-state";
import { NextCallBanner } from "@/components/next-call";
import { PageHero } from "@/components/page-hero";
import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
        `/api/v1/applications${filter === ALL ? "" : `?status=${filter}`}`,
      ),
  });

  const setStage = useMutation({
    mutationFn: ({ stageId, status }: { row: ApplicationRow; stageId: string; status: string }) =>
      request<StageUpdated>(`/api/v1/stages/${stageId}`, {
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
      request(`/api/v1/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    // The board re-sorts on success; an optimistic move would make a failed
    // write look like it landed in the new column.
    onSuccess: () => invalidateSchedule(queryClient),
  });

  const counts = useMemo(() => {
    const items = data?.items ?? [];
    const has = (...statuses: string[]) =>
      items.filter((r) => statuses.includes(r.status)).length;
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

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Pipeline"
        eyebrowIcon={Briefcase}
        title="Applications"
        description="One row per application, one column per interview step. Click a step to schedule it or set its status; click the row for the whole picture."
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              className="h-11"
              onClick={() => setDialog({ mode: "create", draft: {} })}
            >
              <CalendarPlus />
              Schedule
            </Button>
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList className="h-11">
                <TabsTrigger value="table" className="gap-1.5">
                  <Table2 className="size-4" />
                  Table
                </TabsTrigger>
                <TabsTrigger value="board" className="gap-1.5">
                  <Columns3 className="size-4" />
                  Board
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        }
      />

      <NextCallBanner />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="In the pipeline"
          Icon={Briefcase}
          loading={isLoading}
          value={counts.open}
          hint="Saved, applied or in process"
        />
        <StatCard
          label="In process"
          Icon={Activity}
          tone="info"
          loading={isLoading}
          value={counts.inProcess}
          hint="Reached a real conversation"
        />
        <StatCard
          label="Offers"
          Icon={Trophy}
          tone="success"
          loading={isLoading}
          value={counts.offers}
          hint="Offer or hired"
        />
        <StatCard
          label="Closed"
          Icon={Archive}
          tone="warning"
          loading={isLoading}
          value={counts.closed}
          hint="Rejected, withdrawn or ghosted"
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search company, role or location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 pl-9"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-11 w-44" aria-label="Filter by status">
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
        <Card className="py-0">
          <CardContent className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : !rows.length ? (
        <Card className="py-0">
          <EmptyState
            icon={<Briefcase />}
            title={
              q || filter !== ALL ? "Nothing matches those filters" : "No applications yet"
            }
            description={
              q || filter !== ALL
                ? "Clear the search or pick a different status."
                : "Save one after tailoring a resume — from the portal or the extension."
            }
            action={
              !q && filter === ALL ? (
                <Button asChild>
                  <Link href="/tailor">Tailor a resume</Link>
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
