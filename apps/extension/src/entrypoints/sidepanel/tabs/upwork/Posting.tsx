import { Check, ExternalLink, PauseCircle, Radio } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import { isApplyPage } from "@/lib/upwork";
import type { UpworkTabState } from "@/lib/upwork-capture";
import { cn } from "@/lib/utils";
import { Section } from "../../chrome-shell";
import { ErrorNote } from "../../components";
import { ProposalPanel } from "./ProposalPanel";

export interface Teammate {
  name: string;
  you: boolean;
}

interface Watcher extends Teammate {
  /** Theirs is the watch whose client alerts go to everyone. */
  relay: boolean;
}

/** The slice of `GET /freelancing/jobs/upwork/{key}` the panel shows. */
export interface PostingDetail {
  id: string;
  title: string;
  /** When it entered the shared list. */
  created_at: string;
  watchers: Watcher[];
  posted_by: Teammate | null;
}

type Lookup =
  | { state: "loading" }
  | { state: "found"; job: PostingDetail }
  | { state: "missing" }
  | { state: "error"; message: string };

// Who is viewing changes as teammates come and go; watches heartbeat every ~2 min.
const LIVE_MS = 30_000;

export function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** The shared-list row for posting `key`: again on every capture the tab reports, and on a beat. */
function usePosting(key: string, reportedAt: string | undefined): Lookup {
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });

  const load = useCallback(async () => {
    try {
      const job = await api<PostingDetail>(`/api/v1/freelancing/jobs/upwork/${encodeURIComponent(key)}`);
      setLookup({ state: "found", job });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return setLookup({ state: "missing" });
      // A blip while it is showing keeps what it showed.
      setLookup((was) =>
        was.state === "found" ? was : { state: "error", message: e instanceof Error ? e.message : "Could not reach PhoeniX" },
      );
    }
  }, [key]);

  useEffect(() => void load(), [load, reportedAt]);
  useEffect(() => {
    const id = setInterval(() => void load(), LIVE_MS);
    return () => clearInterval(id);
  }, [load]);

  return lookup;
}

/**
 * A tab with one posting open: that posting alone. Whether it is in the shared
 * list, which teammate put it there, who has it open right now, and its proposal.
 */
export function PostingView({
  postingKey,
  url,
  tabState,
  paused,
  portalUrl,
  action,
  problem,
}: {
  postingKey: string;
  url: string;
  tabState: UpworkTabState | null;
  paused: boolean;
  portalUrl: string;
  /** The collect / pause toggle, in the section header. */
  action: ReactNode;
  problem: ReactNode;
}) {
  const lookup = usePosting(postingKey, tabState?.at);
  const job = lookup.state === "found" ? lookup.job : null;

  return (
    <>
      <Section title="This job" action={action}>
        <Card className="py-0">
          <CardContent className="space-y-3 p-3">
            {lookup.state === "loading" ? (
              <div className="space-y-2" aria-busy>
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            ) : lookup.state === "found" ? (
              <Facts job={lookup.job} portalUrl={portalUrl} />
            ) : lookup.state === "missing" ? (
              <NotListed paused={paused} onApplyPage={isApplyPage(url)} />
            ) : (
              <ErrorNote>{lookup.message}</ErrorNote>
            )}
          </CardContent>
        </Card>
        {problem}
      </Section>

      {job && <ProposalPanel job={job} portalUrl={portalUrl} />}
    </>
  );
}

function Facts({ job, portalUrl }: { job: PostingDetail; portalUrl: string }) {
  // You first, then in the order they opened it.
  const viewing = [...job.watchers].sort((a, b) => Number(b.you) - Number(a.you));
  const others = viewing.filter((w) => !w.you).length;

  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="line-clamp-2 text-[13px] leading-snug font-semibold" title={job.title}>
            {job.title}
          </p>
          <p className="text-success inline-flex items-center gap-1 text-[11px] font-medium">
            <Check className="size-3" />
            In the shared list
          </p>
        </div>
        <a
          href={`${portalUrl}/freelancing/jobs/${job.id}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground hover:bg-muted -m-1 shrink-0 rounded-md p-1 transition-colors"
          aria-label="Open in the portal"
          title="Open in the portal"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      <dl className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 border-t pt-3 text-[11px]">
        <dt className="text-muted-foreground pt-0.5">Posted by</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          {job.posted_by ? <Person person={job.posted_by} /> : <span className="text-muted-foreground">A former teammate</span>}
          <span className="text-subtle tabular-nums">{ago(job.created_at)}</span>
        </dd>

        <dt className="text-muted-foreground inline-flex items-center gap-1.5 pt-0.5">
          Viewing
          {others > 0 && (
            <span className="relative flex size-1.5" aria-hidden>
              <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              <span className="bg-success relative inline-flex size-1.5 rounded-full" />
            </span>
          )}
        </dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          {viewing.length ? (
            viewing.map((w) => (
              <Person key={`${w.name}|${w.you}`} person={w}>
                {w.relay && (
                  <span title="Relays client alerts to the team" className="inline-flex">
                    <Radio className="text-primary size-3" aria-label="relays client alerts to the team" />
                  </span>
                )}
              </Person>
            ))
          ) : (
            <span className="text-muted-foreground">Nobody right now</span>
          )}
        </dd>
      </dl>
    </>
  );
}

function Person({ person, children }: { person: Teammate; children?: ReactNode }) {
  const name = person.you ? "You" : person.name;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 transition-transform hover:-translate-y-px",
        person.you ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted/50",
      )}
      title={person.you ? `You (${person.name})` : person.name}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold uppercase",
          person.you ? "bg-primary text-primary-foreground" : "bg-foreground/10",
        )}
        aria-hidden
      >
        {person.name.trim().charAt(0) || "?"}
      </span>
      <span className="truncate font-medium">{name}</span>
      {children}
    </span>
  );
}

/** Open, but not in the shared list: why, in one line. */
function NotListed({ paused, onApplyPage }: { paused: boolean; onApplyPage: boolean }) {
  if (paused) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <PauseCircle className="size-4 shrink-0" />
        Collecting is paused, so this job is not in the shared list. Resume to post it.
      </p>
    );
  }
  if (onApplyPage) {
    return (
      <p className="text-muted-foreground text-xs leading-relaxed">
        This job is not in the shared list yet. Open its job page once to post it.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-xs">
      <Spinner className="size-3.5" />
      Posting this job to the shared list…
    </p>
  );
}
