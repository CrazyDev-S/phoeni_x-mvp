"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { PageHero } from "@/components/page-hero";
import { Panel, Toolbar } from "@/components/panel";
import {
  ResumeTable,
  type LinkedJob,
  type ResumeListItem,
} from "@/components/remote/resume-table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Chip, ChipRow } from "@/components/ui/chip";
import { buttonVariants } from "@/components/ui/button";
import { request } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Page<T> {
  items: T[];
  total: number;
}

interface BaseRow {
  id: string;
  display_name: string;
  target_title: string;
  stack_tags: string[];
  source: string;
  mode: string;
  status: string;
  created_at: string;
  linked_jobs: LinkedJob[];
}

interface TailoredRow {
  id: string;
  display_name: string;
  company_name: string | null;
  job_title: string | null;
  status: string;
  must_have_coverage_percent: number | null;
  created_at: string;
  linked_jobs: LinkedJob[];
}

const SOURCE_LABEL: Record<string, string> = {
  upload: "Uploaded",
  generated_story: "Generated · story",
  generated_job: "Generated · job",
  tailored_instruction: "Edited",
};

type Filter = "all" | "base" | "tailored" | "recent";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["base", "Base resumes"],
  ["tailored", "Tailored"],
  ["recent", "Recent"],
];

const RECENT_DAYS = 14;

export default function ResumesPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingDelete, setPendingDelete] = useState<ResumeListItem | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cascade, setCascade] = useState<{
    message: string;
    count: number;
  } | null>(null);

  const base = useQuery({
    queryKey: ["resumes", q],
    queryFn: () =>
      request<Page<BaseRow>>(
        `/api/v1/remote/resumes?${new URLSearchParams(q ? { q } : {})}`,
      ),
  });
  const tailored = useQuery({
    queryKey: ["tailored-resumes", q],
    queryFn: () =>
      request<Page<TailoredRow>>(
        `/api/v1/remote/tailored-resumes?${new URLSearchParams({ limit: "50", ...(q ? { q } : {}) })}`,
      ),
  });

  const remove = useMutation({
    mutationFn: ({
      resume,
      withCascade,
    }: {
      resume: ResumeListItem;
      withCascade: boolean;
    }) =>
      request(
        resume.kind === "base"
          ? `/api/v1/remote/resumes/${resume.id}${withCascade ? "?cascade=true" : ""}`
          : `/api/v1/remote/tailored-resumes/${resume.id}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      setPendingDelete(null);
      setCascade(null);
      queryClient.invalidateQueries({ queryKey: ["resumes"] });
      queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
    },
    onError: (err) => {
      const e = err as {
        code?: string;
        message?: string;
        detail?: Record<string, unknown>;
      };
      if (e.code === "HAS_TAILORED_VERSIONS" && e.detail) {
        setCascade({
          message: String(e.detail.message ?? ""),
          count: Number(e.detail.tailored_count ?? 0),
        });
      } else {
        setDeleteError(e.message ?? "Could not delete");
      }
    },
  });

  const cards = useMemo<ResumeListItem[]>(() => {
    const cutoff = Date.now() - RECENT_DAYS * 86_400_000;

    const baseCards: ResumeListItem[] = (base.data?.items ?? []).map((r) => ({
      id: r.id,
      kind: "base",
      title: r.display_name,
      subtitle: `${r.target_title} · ${SOURCE_LABEL[r.source] ?? r.source}`,
      tags: r.stack_tags,
      status: r.status,
      createdAt: r.created_at,
      coverage: null,
      href: `/remote/resumes/${r.id}`,
      linkedJobs: r.linked_jobs,
    }));

    const tailoredCards: ResumeListItem[] = (tailored.data?.items ?? []).map(
      (t) => ({
        id: t.id,
        kind: "tailored",
        title: t.display_name,
        subtitle:
          [t.company_name, t.job_title].filter(Boolean).join(" · ") ||
          "Tailored version",
        tags: [],
        company: t.company_name,
        status: t.status,
        createdAt: t.created_at,
        coverage: t.must_have_coverage_percent,
        href: `/remote/resumes/tailored/${t.id}`,
        linkedJobs: t.linked_jobs,
      }),
    );

    const pool =
      filter === "base"
        ? baseCards
        : filter === "tailored"
          ? tailoredCards
          : [...baseCards, ...tailoredCards];

    return pool
      .filter((c) =>
        filter === "recent" ? new Date(c.createdAt).getTime() >= cutoff : true,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [base.data, tailored.data, filter]);

  const loading = base.isLoading || tailored.isLoading;
  const error = (base.error ?? tailored.error) as Error | null;

  return (
    <div className="space-y-3">
      <PageHero
        title="Resumes"
        stats={
          base.data && tailored.data
            ? [
                { value: base.data.total, label: "Base" },
                { value: tailored.data.total, label: "Tailored" },
              ]
            : undefined
        }
        actions={
          <Button asChild variant="brand">
            <Link href="/remote/resumes/new">
              <Plus />
              Add resume
            </Link>
          </Button>
        }
      />

      <Toolbar>
        <div className="relative w-full min-w-56 sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            aria-label="Search resumes"
            placeholder="Search resumes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <ChipRow>
          {FILTERS.map(([value, label]) => (
            <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>
              {label}
            </Chip>
          ))}
        </ChipRow>
        {filter === "recent" && (
          <span className="text-muted-foreground text-xs">Created in the last {RECENT_DAYS} days</span>
        )}
      </Toolbar>

      {error && <ErrorAlert>{error.message}</ErrorAlert>}

      {loading ? (
        <div className="space-y-1" aria-busy>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !cards.length ? (
        <Panel>
          <EmptyState
            icon={<FileText />}
            title={q ? "Nothing matches that search" : "No resumes yet"}
            action={
              !q && (
                <Button asChild size="sm">
                  <Link href="/remote/resumes/new">
                    <Plus />
                    Add your first resume
                  </Link>
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <ResumeTable
          resumes={cards}
          onDelete={(r) => {
            setPendingDelete(r);
            setCascade(null);
            setDeleteError(null);
          }}
        />
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            setCascade(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cascade
                ? "This will delete more than one resume"
                : `Delete “${pendingDelete?.title}”?`}
            </AlertDialogTitle>
            {/* The API refuses the first attempt when tailored versions exist and
                reports how many, so the collateral damage is named before the
                second, explicit confirmation rather than discovered after it. */}
            <AlertDialogDescription>
              {cascade
                ? `${cascade.message} This cannot be undone.`
                : "This permanently removes the resume. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError && <ErrorAlert>{deleteError}</ErrorAlert>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) {
                  remove.mutate({
                    resume: pendingDelete,
                    withCascade: Boolean(cascade),
                  });
                }
              }}
            >
              {cascade ? `Delete all ${cascade.count + 1}` : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
