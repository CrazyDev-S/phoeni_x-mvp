"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  Info,
  Search,
  SlidersHorizontal,
  Square,
  Star,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { JobCard } from "@/components/freelancing/job-card";
import { JobFilters } from "@/components/freelancing/job-filters";
import { JobSourceBanner } from "@/components/freelancing/job-source";
import { FormField } from "@/components/form-field";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { cn } from "@/lib/utils";

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

  const filterCount = activeFilterCount(params);
  const focusedRows = focused.data?.items ?? [];
  const focusedCount = focusedRows.length;
  const searchError = search.error as { message?: string; code?: string } | null;
  const resultsTitle = useMemo(() => {
    if (!meta) return null;
    const shown = results.length;
    const total = meta.total ?? shown;
    return `${shown.toLocaleString()} of ${total.toLocaleString()} postings${meta.hidden_count ? ` · ${meta.hidden_count} hidden` : ""}`;
  }, [meta, results.length]);

  return (
    <div className="space-y-7">
      <PageHero
        title="Jobs"
        stats={
          meta
            ? [
                { value: results.length.toLocaleString(), label: "Showing" },
                { value: (meta.total ?? results.length).toLocaleString(), label: "Postings" },
                ...(meta.hidden_count ? [{ value: meta.hidden_count.toLocaleString(), label: "Hidden" }] : []),
              ]
            : undefined
        }
        actions={
          <Tabs
            value={tab}
            onValueChange={(value) =>
              router.replace(value === "focused" ? "/freelancing/jobs?tab=focused" : "/freelancing/jobs", { scroll: false })
            }
          >
            <TabsList className="bg-card shadow-card">
              <TabsTrigger value="results" className="gap-2">
                <Search className="size-4" />
                Results
              </TabsTrigger>
              <TabsTrigger value="focused" className="gap-2">
                <Star className="size-4" />
                Focused
                {focusedCount > 0 && (
                  <span className="bg-foreground/10 rounded-full px-2 text-[11.5px] font-bold tabular-nums group-data-[variant=default]/tabs-list:in-data-active:bg-white/20">
                    {focusedCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <JobSourceBanner />

      {tab === "focused" ? (
        <FocusedList rows={focusedRows} loading={focused.isLoading} onChange={() => invalidateFreelancing(queryClient)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[350px_minmax(0,1fr)] lg:items-start">
          <aside className="space-y-3 lg:sticky lg:top-24">
            <Button
              variant="secondary"
              className="h-12 w-full justify-between lg:hidden"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
            >
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="size-4" />
                Filters
                {filterCount > 0 && (
                  <span className="bg-accent text-accent-foreground rounded-full px-2 text-xs font-bold tabular-nums">{filterCount}</span>
                )}
              </span>
              <ChevronDown className={cn("size-4 transition-transform", filtersOpen && "rotate-180")} />
            </Button>
            <Card className={cn("gap-0 rounded-[32px] py-0", !filtersOpen && "hidden lg:block")}>
              <CardContent className="max-h-[calc(100vh-8rem)] overflow-y-auto p-5">
                <JobFilters
                  value={params}
                  catalogue={catalogue.data}
                  searching={search.isPending}
                  onChange={setParams}
                  onSearch={() => runSearch()}
                  onReset={() => {
                    setParams(EMPTY_SEARCH);
                    setResults([]);
                    setMeta(null);
                  }}
                />
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-[18px]">
            <div className="flex flex-wrap items-center gap-2.5">
              {(saved.data ?? []).map((s) => (
                <span key={s.id} className="bg-card shadow-card inline-flex h-10 items-center gap-2 rounded-full pr-1.5 pl-3.5 text-[13.5px] font-semibold">
                  <button type="button" className="inline-flex items-center gap-2 hover:underline" onClick={() => runSearch(fromSavedParams(s.params))}>
                    <Bookmark className="text-brand-ink size-[15px]" />
                    {s.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete saved search ${s.name}`}
                    className="bg-soft text-muted-foreground hover:bg-soft-2 grid size-7 place-items-center rounded-full"
                    onClick={() => deleteSaved.mutate(s.id)}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              <Button size="sm" variant="outline" className="h-10" onClick={() => setSaving(true)} disabled={!params.query && filterCount === 0}>
                <BookmarkPlus />
                Save this search
              </Button>
              {resultsTitle && <span className="text-muted-foreground ml-auto text-[13px] font-semibold tabular-nums">{resultsTitle}</span>}
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
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-52 w-full rounded-[30px]" />
                ))}
              </div>
            ) : !results.length ? (
              <Card className="rounded-[30px] py-0">
                <EmptyState
                  icon={<Search />}
                  title={meta ? "Nothing matched" : `Search ${catalogue.data?.source.label ?? "jobs"}`}
                  description={
                    meta
                      ? "Loosen a filter or two. Hidden and applied postings can be shown again from the last group."
                      : "Type what you are looking for, set any filters, and press Search. Results are kept for the session."
                  }
                  action={
                    <Button variant="brand" onClick={() => runSearch()} disabled={search.isPending}>
                      <Search />
                      Search {catalogue.data?.source.label ?? "jobs"}
                    </Button>
                  }
                />
              </Card>
            ) : (
              <>
                <ul className="space-y-[18px]">
                  {results.map((job) => (
                    <li key={job.id}>
                      <JobCard job={job} onChange={replaceCard} onHidden={dropCard} />
                    </li>
                  ))}
                </ul>
                {meta?.has_next_page && !pending && (
                  <div className="flex justify-center pt-2">
                    <Button variant="secondary" size="lg" onClick={loadMore} disabled={search.isPending}>
                      {search.isPending && <Spinner />}
                      Load more
                      {!search.isPending && <ChevronDown />}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Dialog open={saving} onOpenChange={(open) => !open && setSaving(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save this search</DialogTitle>
            <DialogDescription>The filters, without the page position. Saving the same name replaces it.</DialogDescription>
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
    <Card className="gap-0 rounded-[30px] py-0">
      <CardContent className="space-y-3.5 p-5 sm:px-[26px]">
        <div className="flex items-center gap-2.5">
          <Spinner className="text-brand-ink" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{note ?? "Waiting for the job source…"}</span>
          <span className="text-muted-foreground text-sm font-semibold tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <Button size="sm" variant="ghost" onClick={onStop}>
            <Square />
            Stop waiting
          </Button>
        </div>
        <Progress value={percent} aria-label="Search progress" className="**:data-[slot=progress-indicator]:bg-brand h-2" />
        <p className="text-muted-foreground text-xs font-medium">
          A scrape usually takes under a minute. If you stop waiting, the run still finishes, and
          searching again with the same filters picks it up without paying twice.
        </p>
      </CardContent>
    </Card>
  );
}

function FocusedList({ rows, loading, onChange }: { rows: JobCardData[]; loading: boolean; onChange: () => void }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-52 w-full rounded-[30px]" />
        ))}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <Card className="rounded-[30px] py-0">
        <EmptyState
          icon={<Star />}
          title="Nothing focused yet"
          description="Star a posting in the results and it lands here - and in the tracker, at its first stage."
        />
      </Card>
    );
  }
  return (
    <ul className="space-y-[18px]">
      {rows.map((job) => (
        <li key={job.id}>
          <JobCard job={job} onChange={onChange} onHidden={onChange} />
        </li>
      ))}
    </ul>
  );
}
