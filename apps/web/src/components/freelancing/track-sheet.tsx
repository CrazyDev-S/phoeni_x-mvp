"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarPlus,
  ExternalLink,
  FileSignature,
  Trash2,
  Trophy,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StageSelect } from "@/components/freelancing/stage-select";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  CLOSED_STAGES,
  formatBudget,
  invalidateFreelancing,
  PROPOSAL_STATUS_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  type TrackDetail,
  type TrackStage,
} from "@/lib/freelancing";
import { invalidateSchedule } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/**
 * One track, opened beside the board.
 *
 * Notes and the next-action date save on blur; the stage saves at once, with
 * the history underneath so a change is never silent.
 */
export function TrackSheet({
  id,
  onClose,
  onSchedule,
}: {
  id: string | null;
  onClose: () => void;
  onSchedule: (trackId: string) => void;
}) {
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="sr-only">
          <SheetTitle asChild>
            <span>Track</span>
          </SheetTitle>
          <SheetDescription>The posting, the proposal, the stage and its history.</SheetDescription>
        </SheetHeader>
        {id && <TrackDetailView id={id} onClose={onClose} onSchedule={() => onSchedule(id)} />}
      </SheetContent>
    </Sheet>
  );
}

function TrackDetailView({ id, onClose, onSchedule }: { id: string; onClose: () => void; onSchedule: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["freelancing", "track", id],
    queryFn: () => request<TrackDetail>(`/api/v1/freelancing/tracks/${id}`),
  });
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [connects, setConnects] = useState("");

  useEffect(() => {
    if (!data) return;
    setNotes(data.notes_markdown ?? "");
    setOutcome(data.outcome_notes ?? "");
    setNextAction(data.next_action_at ? data.next_action_at.slice(0, 10) : "");
    setConnects(data.connects_spent == null ? "" : String(data.connects_spent));
  }, [data]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<TrackDetail>(`/api/v1/freelancing/tracks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (next) => {
      queryClient.setQueryData(["freelancing", "track", id], next);
      invalidateFreelancing(queryClient);
      invalidateSchedule(queryClient);
    },
  });

  const remove = useMutation({
    mutationFn: () => request(`/api/v1/freelancing/tracks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateFreelancing(queryClient);
      toast.success("Stopped tracking");
      onClose();
    },
  });

  const promote = useMutation({
    mutationFn: () => request<{ id: string }>(`/api/v1/freelancing/tracks/${id}/promote`, { method: "POST" }),
    onSuccess: () => {
      invalidateFreelancing(queryClient);
      queryClient.invalidateQueries({ queryKey: ["maintained-jobs"] });
      toast.success("Added to Job Maintenance");
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4 p-6" aria-busy>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error) return <div className="p-6"><ErrorAlert>{(error as Error).message}</ErrorAlert></div>;

  const closed = CLOSED_STAGES.has(data.stage);
  const onSoft = "bg-card";

  return (
    <div className="space-y-6 p-6 sm:p-7">
      <header className="space-y-3 pr-10">
        <StatusBadge tone={STAGE_TONE[data.stage]}>{STAGE_LABEL[data.stage]}</StatusBadge>
        <h2 className="text-2xl leading-tight font-medium tracking-tight text-balance">{data.job.title}</h2>
        <p className="text-muted-foreground text-sm font-medium">
          <span className="text-foreground font-bold">{formatBudget(data.job)}</span>
          {data.job.client_country ? ` · ${data.job.client_country}` : ""}
          {data.job.total_applicants != null ? ` · ${data.job.total_applicants} proposals` : ""}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm">
            <Link href={`/freelancing/jobs/${data.job_id}`}>
              Open posting
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          {data.job.url && (
            <Button asChild size="sm" variant="outline">
              <a href={data.job.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Upwork
              </a>
            </Button>
          )}
          {data.proposal ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/freelancing/proposals/${data.proposal.id}`}>
                <FileSignature />
                Proposal · {PROPOSAL_STATUS_LABEL[data.proposal.status].label}
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={`/freelancing/proposals?job=${data.job_id}`}>
                <FileSignature />
                Draft a proposal
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="bg-soft grid gap-4 rounded-3xl p-5 sm:grid-cols-2">
        <FormField label="Stage">
          {() => (
            <StageSelect
              value={data.stage}
              disabled={patch.isPending}
              label="Stage"
              className={cn("h-12 text-[0.9375rem]", onSoft)}
              onChange={(stage: TrackStage) => patch.mutate({ stage })}
            />
          )}
        </FormField>
        <FormField label="Next action" hint="A date to come back to this one.">
          {(control) => (
            <Input
              {...control}
              type="date"
              className={onSoft}
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              onBlur={() =>
                patch.mutate({ next_action_at: nextAction ? `${nextAction}T09:00:00Z` : null })
              }
            />
          )}
        </FormField>
        <FormField label="Connects spent">
          {(control) => (
            <Input
              {...control}
              type="number"
              min={0}
              className={onSoft}
              value={connects}
              onChange={(e) => setConnects(e.target.value)}
              onBlur={() => patch.mutate({ connects_spent: connects === "" ? null : Number(connects) })}
            />
          )}
        </FormField>
        <div className="space-y-2 text-sm">
          <p className="text-sm leading-snug font-medium">Timeline</p>
          <dl className="text-muted-foreground space-y-0.5 text-[0.8125rem] font-medium">
            {data.submitted_at && <div>Submitted {formatDateTime(data.submitted_at, "d MMM, HH:mm")}</div>}
            {data.client_replied_at && <div>Client replied {formatDateTime(data.client_replied_at, "d MMM, HH:mm")}</div>}
            {data.closed_at && <div>Closed {formatDateTime(data.closed_at, "d MMM, HH:mm")}</div>}
            {!data.submitted_at && !data.client_replied_at && !data.closed_at && <div>Focused {formatDateTime(data.created_at, "d MMM")}</div>}
          </dl>
        </div>
      </div>

      <FormField label="Notes" hint="Saved when you leave the field.">
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            className="resize-none"
            value={notes}
            placeholder="Questions to ask, what the client said, what to send next…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (data.notes_markdown ?? "") && patch.mutate({ notes_markdown: notes || null })}
          />
        )}
      </FormField>
      {closed && (
        <FormField label="Outcome">
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={outcome}
              placeholder="Why it ended the way it did."
              onChange={(e) => setOutcome(e.target.value)}
              onBlur={() => outcome !== (data.outcome_notes ?? "") && patch.mutate({ outcome_notes: outcome || null })}
            />
          )}
        </FormField>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-medium tracking-tight">Calls</h3>
          {!closed && (
            <Button size="sm" variant="outline" onClick={onSchedule}>
              <CalendarPlus />
              Schedule
            </Button>
          )}
        </div>
        {data.meetings.length ? (
          <ul className="bg-soft space-y-2 rounded-3xl p-2.5">
            {data.meetings.map((m) => (
              <li key={m.id} className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">{m.title}</span>
                <span className="text-muted-foreground text-xs font-medium tabular-nums">{formatDateTime(m.starts_at, "d MMM, HH:mm")}</span>
                <StatusBadge tone={m.status === "held" ? "ok" : m.status === "cancelled" ? "bad" : "neutral"}>{m.status}</StatusBadge>
                {m.conferencing_url && (
                  <Button asChild size="xs" variant="outline">
                    <a href={m.conferencing_url} target="_blank" rel="noreferrer">
                      <Video />
                      Join
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm font-medium">No calls booked. They show up on the shared calendar.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-medium tracking-tight">History</h3>
        <ol className="space-y-3">
          {data.events.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 text-[0.8125rem]">
              <span aria-hidden className="bg-brand mt-1.5 size-2 shrink-0 self-start rounded-full" />
              <span className="text-muted-foreground w-28 shrink-0 font-medium tabular-nums">{formatDateTime(e.occurred_at, "d MMM, HH:mm")}</span>
              <span className="text-muted-foreground font-medium">
                <span className="text-foreground font-semibold">{STAGE_LABEL[e.to_stage]}</span>
                {e.reason ? ` — ${e.reason}` : ""}
                {e.actor !== "user" ? ` (${e.actor})` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {(patch.error || remove.error || promote.error) && (
        <ErrorAlert>{((patch.error ?? remove.error ?? promote.error) as Error).message}</ErrorAlert>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-5">
        {(data.stage === "interviewing" || data.stage === "hired") && (
          <Button variant="brand" disabled={promote.isPending} onClick={() => promote.mutate()}>
            {promote.isPending ? <Spinner /> : <Trophy />}
            Won it — add to Job Maintenance
          </Button>
        )}
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-destructive ml-auto"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 />
          Stop tracking
        </Button>
      </div>
    </div>
  );
}
