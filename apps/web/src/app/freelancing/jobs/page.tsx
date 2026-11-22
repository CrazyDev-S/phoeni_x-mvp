"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, ChevronDown, ExternalLink, Puzzle, RotateCcw, SearchX, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { ActiveFilters } from "@/components/freelancing/active-filters";
import { JobFilters } from "@/components/freelancing/job-filters";
import { JobList } from "@/components/freelancing/job-list";
import { JobToolbar } from "@/components/freelancing/job-toolbar";
import { UpworkRefresh } from "@/components/freelancing/upwork-refresh";
import { FormField } from "@/components/form-field";
import { PageHero } from "@/components/page-hero";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { ChipCount } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebounced } from "@/hooks/use-debounced";
import { request } from "@/lib/api";
import {
  EMPTY_FILTER,
  fromSavedParams,
  invalidateFreelancing,
  isFiltered,
  toFilterBody,
  type JobCard as JobCardData,
  type JobFilter,
  type Page,
  type SavedSearch,
} from "@/lib/freelancing";

type Tab = "all" | "focused";

const PAGE_SIZE = 50;
// The shared list grows while people browse Upwork; this is how often it is re-read.
const REFRESH_MS = 60_000;
// The filter survives opening a posting and coming back. Session only.
const REMEMBER_KEY = "phoenix.jobs.filter";

function recall(): JobFilter {
  try {
    const raw = sessionStorage.getItem(REMEMBER_KEY);
    return raw ? { ...EMPTY_FILTER, ...(JSON.parse(raw) as Partial<JobFilter>) } : EMPTY_FILTER;
  } catch {
    return EMPTY_FILTER;
  }
}

function remember(filter: JobFilter) {
  try {
    sessionStorage.setItem(REMEMBER_KEY, JSON.stringify(filter));
  } catch {
    // Storage blocked: the filter still works, it is just not kept.
  }
}

export default function JobsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Jobs />
    </Suspense>
  );
}

function Jobs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tab: Tab = searchParams.get("tab") === "focused" ? "focused" : "all";

  const [filter, setFilter] = useState<JobFilter>(EMPTY_FILTER);
  const [restored, setRestored] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    setFilter(recall());
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored) remember(filter);
  }, [filter, restored]);

  // Typing settles before the list is asked; picks and toggles barely wait.
  const asked = useDebounced(filter, 250);
  const body = toFilterBody(asked);

  const list = useInfiniteQuery({
    queryKey: ["freelancing", "jobs", "list", body],
    queryFn: ({ pageParam }) =>
      request<Page<JobCardData>>("/api/v1/freelancing/jobs/search", {
        method: "POST",
        body: JSON.stringify({ ...body, limit: PAGE_SIZE, offset: pageParam }),
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    enabled: restored && tab === "all",
  });
  const focused = useQuery({
    queryKey: ["freelancing", "jobs", "focused"],
    queryFn: () => request<Page<JobCardData>>("/api/v1/freelancing/jobs?focused=true&limit=200"),
  });
  const saved = useQuery({
    queryKey: ["freelancing", "jobs", "saved-searches"],
    queryFn: () => request<SavedSearch[]>("/api/v1/freelancing/jobs/saved-searches"),
  });

  const saveSearch = useMutation({
    mutationFn: () =>
      request<SavedSearch>("/api/v1/freelancing/jobs/saved-searches", {
        method: "PUT",
        body: JSON.stringify({ name: saveName.trim(), params: toFilterBody(filter) }),
      }),
    onSuccess: (row) => {
      setSaving(false);
      setSaveName("");
      toast.success(`Saved “${row.name}”`);
      queryClient.invalidateQueries({ queryKey: ["freelancing", "jobs", "saved-searches"] });
    },
  });
  const deleteSaved = useMutation({
    mutationFn: (id: string) => request(`/api/v1/freelancing/jobs/saved-searches/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["freelancing", "jobs", "saved-searches"] }),
  });

  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = isFiltered(filter);
  const focusedRows = focused.data?.items ?? [];
  const refresh = () => invalidateFreelancing(queryClient);

  return (
    <div className="space-y-3">
      <PageHero
        title="Jobs"
        actions={
          <Tabs
            value={tab}
            onValueChange={(value) =>
              router.replace(value === "focused" ? "/freelancing/jobs?tab=focused" : "/freelancing/jobs", { scroll: false })
            }
          >
            <TabsList>
              <TabsTrigger value="all">All jobs</TabsTrigger>
              <TabsTrigger value="focused" className="gap-1.5">
                <Star className="size-3.5" />
                Focused
                {focusedRows.length > 0 && <ChipCount className="bg-foreground/10">{focusedRows.length}</ChipCount>}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {tab === "focused" ? (
        focused.isLoading ? (
          <ListSkeleton />
        ) : !focusedRows.length ? (
          <Panel>
            <EmptyState icon={<Star />} title="Nothing focused yet. Star a posting to track it." />
          </Panel>
        ) : (
          <JobList jobs={focusedRows} onChange={refresh} onHidden={refresh} />
        )
      ) : (
        <>
          <JobToolbar value={filter} onChange={setFilter} onOpenFilters={() => setFiltersOpen(true)} />

          <div className="flex flex-wrap items-center gap-1.5">
            {(saved.data ?? []).map((s) => (
              <span key={s.id} className="bg-card inline-flex h-6 max-w-xs items-center rounded-md border pl-2 text-xs font-medium">
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1 hover:underline"
                  title={s.name}
                  onClick={() => setFilter(fromSavedParams(s.params))}
                >
                  <Bookmark className="text-brand-ink size-3 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete saved search ${s.name}`}
                  className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center"
                  onClick={() => deleteSaved.mutate(s.id)}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Button size="xs" variant="outline" onClick={() => setSaving(true)} disabled={!filtered}>
              <BookmarkPlus />
              Save search
            </Button>
            <ActiveFilters value={filter} onChange={setFilter} />
            <div className="ml-auto flex items-center gap-2">
              {list.data && (
                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs tabular-nums">
                  {list.isFetching && <Spinner className="size-3" />}
                  {rows.length < total ? `${rows.length.toLocaleString()} of ${total.toLocaleString()}` : total.toLocaleString()}{" "}
                  {total === 1 ? "job" : "jobs"}
                </span>
              )}
              <UpworkRefresh onRefresh={() => list.refetch()} />
            </div>
          </div>

          {list.error && <ErrorAlert title="Could not load jobs">{(list.error as Error).message}</ErrorAlert>}

          {!list.data ? (
            <ListSkeleton />
          ) : !rows.length ? (
            <Panel>
              {filtered ? (
                <EmptyState
                  icon={<SearchX />}
                  title="Nothing matches. Loosen a filter."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setFilter(EMPTY_FILTER)}>
                      <RotateCcw />
                      Reset filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Puzzle />}
                  title="No Upwork jobs yet"
                  description="Browse Upwork with the PhoeniX extension on. Every posting you scroll past or open lands here, for the whole team."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button asChild size="sm" variant="brand">
                        <Link href="/settings?tab=extension">
                          <Puzzle />
                          Get the extension
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a href="https://www.upwork.com/nx/find-work/" target="_blank" rel="noreferrer">
                          <ExternalLink />
                          Open Upwork
                        </a>
                      </Button>
                    </div>
                  }
                />
              )}
            </Panel>
          ) : (
            <>
              <JobList jobs={rows} onChange={refresh} onHidden={refresh} />
              {list.hasNextPage && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                    {list.isFetchingNextPage && <Spinner />}
                    Load more
                    {!list.isFetchingNextPage && <ChevronDown />}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          className="data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:rounded-none data-[side=right]:sm:max-w-md"
          aria-describedby={undefined}
        >
          <SheetHeader className="border-b py-3">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4">
            <JobFilters value={filter} onChange={setFilter} />
          </div>
          <SheetFooter className="mt-0 flex-row justify-between border-t py-3">
            <Button variant="ghost" onClick={() => setFilter({ ...EMPTY_FILTER, query: filter.query })}>
              <RotateCcw />
              Reset all
            </Button>
            <Button variant="brand" onClick={() => setFiltersOpen(false)}>
              Show {total.toLocaleString()} {total === 1 ? "job" : "jobs"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={saving} onOpenChange={(open) => !open && setSaving(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this search</DialogTitle>
          </DialogHeader>
          <FormField label="Name">
            {(control) => (
              <Input {...control} value={saveName} autoFocus placeholder="FastAPI, hourly, verified" onChange={(e) => setSaveName(e.target.value)} />
            )}
          </FormField>
          {saveSearch.error && <ErrorAlert>{(saveSearch.error as Error).message}</ErrorAlert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaving(false)}>
              Cancel
            </Button>
            <Button disabled={!saveName.trim() || saveSearch.isPending} onClick={() => saveSearch.mutate()}>
              {saveSearch.isPending && <Spinner />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListSkeleton() {
  return (
    <Panel className="divide-y">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="flex h-11 items-center px-3">
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </Panel>
  );
}
