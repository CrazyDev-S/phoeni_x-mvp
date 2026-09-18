"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Layers, Library, Lightbulb, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { PageHero } from "@/components/page-hero";
import { CheckList, FactList, SidePanel } from "@/components/side-panel";
import { StepsBand } from "@/components/steps-band";
import { ResumeCard, type ResumeCardModel } from "@/components/resume-card";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
}

interface TailoredRow {
  id: string;
  display_name: string;
  company_name: string | null;
  job_title: string | null;
  status: string;
  must_have_coverage_percent: number | null;
  created_at: string;
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

const RESUME_TIPS = [
  "Name a resume for its stack, not for a company.",
  "Keep the target title close to the roles you are applying for.",
  "Tailored versions inherit everything from their base — fix the base once.",
  "Search covers the whole resume body, not just the title.",
];

export default function ResumesPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingDelete, setPendingDelete] = useState<ResumeCardModel | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cascade, setCascade] = useState<{ message: string; count: number } | null>(null);

  const base = useQuery({
    queryKey: ["resumes", q],
    queryFn: () =>
      request<Page<BaseRow>>(`/api/v1/resumes?${new URLSearchParams(q ? { q } : {})}`),
  });
  const tailored = useQuery({
    queryKey: ["tailored-resumes", q],
    queryFn: () =>
      request<Page<TailoredRow>>(
        `/api/v1/tailored-resumes?${new URLSearchParams({ limit: "50", ...(q ? { q } : {}) })}`,
      ),
  });

  const remove = useMutation({
    mutationFn: ({
      resume,
      withCascade,
    }: {
      resume: ResumeCardModel;
      withCascade: boolean;
    }) =>
      request(
        resume.kind === "base"
          ? `/api/v1/resumes/${resume.id}${withCascade ? "?cascade=true" : ""}`
          : `/api/v1/tailored-resumes/${resume.id}`,
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

  const cards = useMemo<ResumeCardModel[]>(() => {
    const cutoff = Date.now() - RECENT_DAYS * 86_400_000;

    const baseCards: ResumeCardModel[] = (base.data?.items ?? []).map((r) => ({
      id: r.id,
      kind: "base",
      title: r.display_name,
      subtitle: `${r.target_title} · ${SOURCE_LABEL[r.source] ?? r.source}`,
      tags: r.stack_tags,
      status: r.status,
      createdAt: r.created_at,
      coverage: null,
      href: `/resumes/${r.id}`,
    }));

    const tailoredCards: ResumeCardModel[] = (tailored.data?.items ?? []).map((t) => ({
      id: t.id,
      kind: "tailored",
      title: t.display_name,
      subtitle:
        [t.company_name, t.job_title].filter(Boolean).join(" · ") || "Tailored version",
      tags: [],
      status: t.status,
      createdAt: t.created_at,
      coverage: t.must_have_coverage_percent,
      href: `/resumes/tailored/${t.id}`,
    }));

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
    <div className="space-y-8">
      <PageHero
        eyebrow="Your library"
        eyebrowIcon={Library}
        title="Resumes"
        description="Manage your base resumes and the tailored versions written from them."
        actions={
          <Button asChild size="lg" className="h-11">
            <Link href="/resumes/new">
              <Plus />
              Add resume
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search resumes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 pl-9"
          />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-11">
            {FILTERS.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error && <ErrorAlert>{error.message}</ErrorAlert>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="gap-0 p-5">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-1/2" />
                  <div className="mt-4 flex gap-1.5">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <Skeleton className="mt-4 h-4 w-full" />
                </Card>
              ))}
            </div>
          ) : !cards.length ? (
            <Card className="py-0">
              <EmptyState
                icon={<FileText />}
                title={q ? "Nothing matches that search" : "No resumes yet"}
                description={
                  q
                    ? "Full-text search covers the whole resume body, not just the title."
                    : "Upload an existing resume or create one from a job description."
                }
                action={
                  !q && (
                    <Button asChild>
                      <Link href="/resumes/new">
                        <Plus />
                        Add your first resume
                      </Link>
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {cards.map((resume) => (
                <ResumeCard
                  key={`${resume.kind}-${resume.id}`}
                  resume={resume}
                  onDelete={(r) => {
                    setPendingDelete(r);
                    setCascade(null);
                    setDeleteError(null);
                  }}
                />
              ))}
            </div>
          )}

          <StepsBand
            title="Base or tailored?"
            description="Two kinds of document, two different jobs."
            steps={[
              {
                title: "Keep base resumes broad",
                detail: "One per stack or seniority, not one per posting.",
              },
              {
                title: "Tailor per posting",
                detail:
                  "Each tailored version is written against one job and scored against it.",
              },
              {
                title: "Send the right file",
                detail: "Use the ATS version for Workday and Taleo upload forms.",
              },
            ]}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <SidePanel icon={Lightbulb} title="Tips for better results">
            <CheckList items={RESUME_TIPS} />
          </SidePanel>
          <SidePanel icon={Layers} title="What is in your library">
            <FactList
              items={[
                { label: "Base resumes", value: base.data?.total ?? 0 },
                { label: "Tailored versions", value: tailored.data?.total ?? 0 },
                { label: "Showing", value: cards.length },
              ]}
            />
          </SidePanel>
        </aside>
      </div>

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
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) {
                  remove.mutate({ resume: pendingDelete, withCascade: Boolean(cascade) });
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
