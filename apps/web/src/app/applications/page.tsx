"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  Briefcase,
  CalendarPlus,
  Check,
  Columns3,
  Search,
  Table2,
  Trophy,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ApplicationBoard } from "@/components/applications/board";
import { StatusSelect } from "@/components/applications/status-select";
import {
  STATUS_LABEL,
  STATUS_TONE,
  STATUSES,
  type ApplicationRow,
} from "@/components/applications/shared";
import { EmptyState } from "@/components/empty-state";
import { PageHero } from "@/components/page-hero";
import { StatCard } from "@/components/stat-card";
import { NextCallBanner } from "@/components/next-call";
import { StatusBadge } from "@/components/status-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { request } from "@/lib/api";
import { formatDateTime, IMMINENT_MINUTES } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALL = "all";
const COLUMNS = [
  "Company",
  "Role",
  "Status",
  "Progress",
  "Current stage",
  "Next call",
  "Match",
  "",
];

type View = "table" | "board";

export default function ApplicationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(ALL);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("table");
  const [prompt, setPrompt] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["applications", filter],
    queryFn: () =>
      request<{ items: ApplicationRow[]; total: number }>(
        `/api/v1/applications${filter === ALL ? "" : `?status=${filter}`}`,
      ),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    queryClient.invalidateQueries({ queryKey: ["next-call"] });
    queryClient.invalidateQueries({ queryKey: ["upcoming"] });
  };

  const setStage = useMutation({
    mutationFn: ({ stageId, status }: { stageId: string; status: string }) =>
      request<{ suggested_next_stage: { name: string } | null }>(
        `/api/v1/stages/${stageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      ),
    onSuccess: (res) => {
      invalidate();
      if (res.suggested_next_stage) {
        setPrompt(`Passed. Next up: ${res.suggested_next_stage.name} — schedule it?`);
      }
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
    onSuccess: invalidate,
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
      `${r.company_name} ${r.role_title} ${r.location ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [data, q]);

  return (
    <div className="space-y-8">
      <NextCallBanner />

      <PageHero
        eyebrow="Pipeline"
        eyebrowIcon={Briefcase}
        title="Applications"
        description="Every saved application, its current stage, and the next call — as a table or a board."
        actions={
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
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {prompt && (
        <Alert>
          <CalendarPlus />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{prompt}</span>
            <Button asChild size="sm" className="ml-auto">
              <Link href="/calendar">Open calendar</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPrompt(null)}>
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
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((h, i) => (
                      <TableHead key={h || i} className="px-4">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const soon =
                      r.next_meeting &&
                      (new Date(r.next_meeting.starts_at).getTime() - Date.now()) / 60000 <=
                        IMMINENT_MINUTES;
                    return (
                      <TableRow key={r.id} className={soon ? "bg-accent/50" : undefined}>
                        <TableCell className="px-4 font-medium">
                          <Link href={`/applications/${r.id}`} className="hover:underline">
                            {r.company_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground px-4">
                          {r.role_title}
                        </TableCell>
                        <TableCell className="px-4">
                          <div className="w-36">
                            <StatusSelect
                              value={r.status}
                              disabled={setStatus.isPending}
                              label={`Status for ${r.company_name}`}
                              onChange={(status) => setStatus.mutate({ id: r.id, status })}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground px-4 tabular-nums">
                          {r.stages_passed}/{r.stage_count}
                        </TableCell>
                        <TableCell className="px-4">
                          {r.current_stage?.name ?? "—"}
                        </TableCell>
                        <TableCell className="px-4">
                          {r.next_meeting ? (
                            <span
                              className={cn(
                                "tabular-nums",
                                soon && "text-primary font-medium",
                              )}
                            >
                              {formatDateTime(r.next_meeting.starts_at, "d MMM HH:mm zzz")}
                            </span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4">
                          {r.must_have_coverage_percent != null ? (
                            <StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>
                              {Math.round(r.must_have_coverage_percent)}%
                            </StatusBadge>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4">
                          {r.current_stage && (
                            <div className="flex justify-end gap-1">
                              <StageButton
                                label={`Mark “${r.current_stage.name}” passed`}
                                disabled={setStage.isPending}
                                onClick={() =>
                                  setStage.mutate({
                                    stageId: r.current_stage!.id,
                                    status: "passed",
                                  })
                                }
                              >
                                <Check />
                              </StageButton>
                              <StageButton
                                label={`Mark “${r.current_stage.name}” failed`}
                                disabled={setStage.isPending}
                                onClick={() =>
                                  setStage.mutate({
                                    stageId: r.current_stage!.id,
                                    status: "failed",
                                  })
                                }
                              >
                                <X />
                              </StageButton>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StageButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
