"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, ChevronDown, Info, RotateCcw, Search, Square, Star, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { ActiveFilters } from "@/components/freelancing/active-filters";
import { JobFilters } from "@/components/freelancing/job-filters";
import { JobList } from "@/components/freelancing/job-list";
import { JobSourceBanner } from "@/components/freelancing/job-source";
import { JobToolbar } from "@/components/freelancing/job-toolbar";
import { FormField } from "@/components/form-field";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/panel";
import { ChipCount } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { request } from "@/lib/api";
import {
  activeFilterCount,
  EMPTY_SEARCH,
  fromSavedParams,
  invalidateFreelancing,
  toSearchBody,
  type FilterCatalogue,
  type JobCard as JobCardData,
  type JobSearchPage,
  type JobSearchParams,
  type SavedSearch,
} from "@/lib/freelancing";

type Tab = "results" | "focused";

interface SearchVariables {
  next: JobSearchParams;
  append: boolean;
  /** Which search this answer belongs to; see `searchNumber`. */
  number: number;
  /** When the search started, for the elapsed time on a pending run. */
  since: number;
}

interface Remembered {
  params: JobSearchParams;
  results: JobCardData[];
  meta: Meta | null;
}

interface Meta {
  total: number | null;
  has_next_page: boolean;
  end_cursor: string | null;
  hidden_count: number;
}

// The last search survives opening a posting and coming back. Session only:
// Upwork's results are a day old at most, and so is this.
const REMEMBER_KEY = "phoenix.jobs.search";
const REMEMBER_LIMIT = 200;

function remember(state: Remembered) {
  try {
    sessionStorage.setItem(
      REMEMBER_KEY,
      JSON.stringify({ ...state, results: state.results.slice(0, REMEMBER_LIMIT) }),
    );
  } catch {
    // Storage is full or blocked; the search still works, it is just not kept.
  }
}

function recall(): Remembered | null {
  try {
    const raw = sessionStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Remembered;
    return { ...parsed, params: { ...EMPTY_SEARCH, ...parsed.params } };
  } catch {
    return null;
  }
}

export default function JobsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <JobsSearch />
    </Suspense>
  );
}

function JobsSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tab: Tab = searchParams.get("tab") === "focused" ? "focused" : "results";

  const [params, setParams] = useState<JobSearchParams>(EMPTY_SEARCH);
  const [results, setResults] = useState<JobCardData[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [restored, setRestored] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  // A search the source is still working on (an Apify run). Each search gets
  // a number; answers to an older one are ignored, which is also how "Stop"
  // works: it retires the number.
  const [pending, setPending] = useState<{ note: string | null; since: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchNumber = useRef(0);

  useEffect(() => {
    const kept = recall();
    if (kept) {
      setParams(kept.params);
      setResults(kept.results);
      setMeta(kept.meta);
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored) remember({ params, results, meta });
  }, [params, results, meta, restored]);

  const catalogue = useQuery({
    queryKey: ["freelancing", "jobs", "filters"],
    queryFn: () => request<FilterCatalogue>("/api/v1/freelancing/jobs/filters"),
    staleTime: 60 * 60_000,
  });
  const saved = useQuery({
    queryKey: ["freelancing", "jobs", "saved-searches"],
    queryFn: () => request<SavedSearch[]>("/api/v1/freelancing/jobs/saved-searches"),
  });
  const focused = useQuery({
    queryKey: ["freelancing", "jobs", "focused"],
    queryFn: () => request<{ items: JobCardData[]; total: number }>("/api/v1/freelancing/jobs?focused=true&limit=200"),
  });

  const search = useMutation({
    mutationFn: ({ next }: SearchVariables) =>
      request<JobSearchPage>("/api/v1/freelancing/jobs/search", {
        method: "POST",
        body: JSON.stringify(toSearchBody(next)),
      }),
    onSuccess: (page, variables) => {
      const { append, number } = variables;
      if (number !== searchNumber.current) return;
      if (page.pending && page.end_cursor) {
        // The source long-polls on its side, so asking again straight away is
        // not a busy loop: each ask waits up to half a minute for the run.
        setPending({ note: page.progress_note, since: variables.since });
        const cursor = page.end_cursor;
        setTimeout(() => {
          if (number === searchNumber.current) {
            search.mutate({ ...variables, next: { ...variables.next, cursor } });
          }
        }, 400);
        return;
      }
      setPending(null);
      setNotice(page.notice);
      setResults((current) => (append ? [...current, ...page.items] : page.items));
      setMeta({
        total: page.total,
        has_next_page: page.has_next_page,
        end_cursor: page.end_cursor,
        hidden_count: page.hidden_count + (append ? (meta?.hidden_count ?? 0) : 0),
      });
      // Focus state and proposal counts on the cards come from the same rows.
      queryClient.invalidateQueries({ queryKey: ["freelancing", "jobs", "focused"] });
    },
    onError: (_, { number }) => {
      if (number === searchNumber.current) setPending(null);
    },
  });

  const startSearch = (next: JobSearchParams, append: boolean) => {
    searchNumber.current += 1;
    setPending(null);
    if (!append) setNotice(null);
    search.mutate({ next, append, number: searchNumber.current, since: Date.now() });
  };

  const stopWaiting = () => {
    searchNumber.current += 1;
    setPending(null);
  };

  const runSearch = useCallback(
    (next: JobSearchParams = params) => {
      const fresh = { ...next, cursor: null };
      setParams(fresh);
      setFiltersOpen(false);
      if (tab !== "results") router.replace("/freelancing/jobs", { scroll: false });
      startSearch(fresh, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, tab, router],
  );

  const loadMore = () => {
    if (!meta?.end_cursor) return;
    startSearch({ ...params, cursor: meta.end_cursor }, true);
  };

  const replaceCard = useCallback((next: JobCardData) => {
    setResults((current) => current.map((job) => (job.id === next.id ? next : job)));
  }, []);
  const dropCard = useCallback(
    (hidden: JobCardData) => {
      if (params.hide_hidden) setResults((current) => current.filter((job) => job.id !== hidden.id));
    },
    [params.hide_hidden],
  );

  const saveSearch = useMutation({
    mutationFn: () =>
      request<SavedSearch>("/api/v1/freelancing/jobs/saved-searches", {
        method: "PUT",
        body: JSON.stringify({ name: saveName.trim(), params: toSearchBody(params) }),
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

  const hasSearch = Boolean(params.query) || activeFilterCount(params) > 0;
  const focusedRows = focused.data?.items ?? [];
  const focusedCount = focusedRows.length;
  const searchError = search.error as { message?: string; code?: string } | null;
  const resultsTitle = useMemo(() => {
    if (!meta) return null;
    const shown = results.length;
    const total = meta.total ?? shown;
    return `${shown.toLocaleString()} of ${total.toLocaleString()}${meta.hidden_count ? ` · ${meta.hidden_count} hidden` : ""}`;
  }, [meta, results.length]);
  const reset = () => {
    setParams(EMPTY_SEARCH);
    setResults([]);
    setMeta(null);
  };

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
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="focused" className="gap-1.5">
                <Star className="size-3.5" />
                Focused
                {focusedCount > 0 && <ChipCount className="bg-foreground/10">{focusedCount}</ChipCount>}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <JobSourceBanner />

      {tab === "focused" ? (
        <FocusedList rows={focusedRows} loading={focused.isLoading} onChange={() => invalidateFreelancing(queryClient)} />
      ) : (
        <>
          <JobToolbar
            value={params}
            catalogue={catalogue.data}
            searching={search.isPending}
            onChange={setParams}
            onSearch={() => runSearch()}
            onReset={reset}
            onOpenFilters={() => setFiltersOpen(true)}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {(saved.data ?? []).map((s) => (
              <span key={s.id} className="bg-card inline-flex h-6 max-w-xs items-center rounded-md border pl-2 text-xs font-medium">
                <button type="button" className="inline-flex min-w-0 items-center gap-1 hover:underline" title={s.name} onClick={() => runSearch(fromSavedParams(s.params))}>
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
            <Button size="xs" variant="outline" onClick={() => setSaving(true)} disabled={!hasSearch}>
              <BookmarkPlus />
              Save search
            </Button>
            <ActiveFilters value={params} catalogue={catalogue.data} onChange={setParams} />
            {resultsTitle && <span className="text-muted-foreground ml-auto text-xs tabular-nums">{resultsTitle}</span>}
          </div>

          {pending && <PendingRun note={pending.note} since={pending.since} onStop={stopWaiting} />}

          {notice && !pending && (
            <Alert>
              <Info />
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          {searchError && (
            <ErrorAlert title={searchError.code === "UPWORK_NOT_CONFIGURED" || searchError.code === "UPWORK_NOT_CONNECTED" ? "Upwork is not connected" : "Search failed"}>
              {searchError.message}
            </ErrorAlert>
          )}

          {(search.isPending || pending) && !results.length ? (
            <ListSkeleton />
          ) : !results.length ? (
            <Panel>
              <EmptyState
                icon={<Search />}
                title={meta ? "Nothing matched. Loosen a filter." : `Search ${catalogue.data?.source.label ?? "jobs"}`}
                action={
                  <Button variant="brand" onClick={() => runSearch()} disabled={search.isPending}>
                    <Search />
                    Search
                  </Button>
                }
              />
            </Panel>
          ) : (
            <>
              <JobList jobs={results} onChange={replaceCard} onHidden={dropCard} />
              {meta?.has_next_page && !pending && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={loadMore} disabled={search.isPending}>
                    {search.isPending && <Spinner />}
                    Load more
                    {!search.isPending && <ChevronDown />}
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
            <JobFilters value={params} catalogue={catalogue.data} onChange={setParams} onSearch={() => runSearch()} />
          </div>
          <SheetFooter className="mt-0 flex-row justify-between border-t py-3">
            <Button variant="ghost" onClick={reset}>
              <RotateCcw />
              Reset all
            </Button>
            <Button variant="brand" onClick={() => runSearch()} disabled={search.isPending}>
              {search.isPending ? <Spinner /> : <Search />}
              Search {catalogue.data?.source.label ?? "jobs"}
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

/**
 * A scrape in progress. A run takes tens of seconds, so the time and the
 * source's own words are shown - a bare spinner for that long reads as a hang.
 */
function PendingRun({ note, since, onStop }: { note: string | null; since: number; onStop: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  // An indeterminate bar would say nothing; this fills over a typical run.
  const percent = Math.min(95, Math.round((seconds / 90) * 100));
  return (
    <Panel className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <Spinner className="text-brand-ink" />
        <span className="min-w-0 flex-1 truncate text-[13px]">{note ?? "Waiting for the job source…"}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
        <Button size="xs" variant="ghost" onClick={onStop} title="The run still finishes; searching again with the same filters picks it up">
          <Square />
          Stop waiting
        </Button>
      </div>
      <Progress value={percent} aria-label="Search progress" className="**:data-[slot=progress-indicator]:bg-brand" />
    </Panel>
  );
}

function FocusedList({ rows, loading, onChange }: { rows: JobCardData[]; loading: boolean; onChange: () => void }) {
  if (loading) return <ListSkeleton />;
  if (!rows.length) {
    return (
      <Panel>
        <EmptyState icon={<Star />} title="Nothing focused yet. Star a posting to track it." />
      </Panel>
    );
  }
  return <JobList jobs={rows} onChange={onChange} onHidden={onChange} />;
}
