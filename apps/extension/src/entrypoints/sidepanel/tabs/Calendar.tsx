import { CalendarOff, ChevronLeft, ChevronRight, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { EmptyNote, Section } from "../chrome-shell";
import { ErrorNote, formatTime } from "../components";

interface Meeting {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  conferencing_url: string | null;
  preparation_notes: string | null;
}

const STATUSES = ["scheduled", "held", "cancelled", "rescheduled", "no_show"];

/** Day agenda, not a month grid — the panel is ~360px wide. */
export function CalendarTab() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Meeting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (target: string) => {
    setBusy(true);
    try {
      setItems(await api<Meeting[]>(`/api/v1/meetings?from=${target}&to=${target}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => void load(day), [day, load]);

  async function setStatus(id: string, status: string) {
    // Optimistic: the panel is often used while a call is starting.
    setItems((list) => list.map((m) => (m.id === id ? { ...m, status } : m)));
    try {
      await api(`/api/v1/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      setError((e as Error).message);
      void load(day);
    }
  }

  function shift(days: number) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setDate(d.getDate() + days);
    setDay(d.toISOString().slice(0, 10));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous day"
          onClick={() => shift(-1)}
        >
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          aria-label="Day"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="h-8 flex-1 text-center"
        />
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next day"
          onClick={() => shift(1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDay(new Date().toISOString().slice(0, 10))}
        >
          Today
        </Button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Section title={busy ? "Loading…" : `${items.length} scheduled`}>
        {busy ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : !items.length ? (
          <EmptyNote icon={CalendarOff}>
            Nothing scheduled on this day. Meetings appear once you schedule an interview
            stage or create a recurring team meeting.
          </EmptyNote>
        ) : (
          <ul className="space-y-2">
            {items.map((m) => (
              <li key={m.id} className="bg-card space-y-2 rounded-xl border p-3">
                <div className="flex items-baseline gap-2">
                  <strong className="text-primary shrink-0 text-xs tabular-nums">
                    {formatTime(m.starts_at)}
                  </strong>
                  <span className="min-w-0 flex-1 text-xs font-medium">{m.title}</span>
                </div>

                {m.preparation_notes && (
                  <p className="text-muted-foreground border-l-2 pl-2 text-[11px] leading-relaxed">
                    {m.preparation_notes}
                  </p>
                )}

                <div className="flex items-center gap-1.5">
                  <Select
                    value={m.status}
                    onValueChange={(value) => setStatus(m.id, value)}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label="Status"
                      className="flex-1 capitalize"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">
                          {s.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {m.conferencing_url && (
                    <Button asChild size="sm">
                      <a href={m.conferencing_url} target="_blank" rel="noreferrer">
                        <Video />
                        Join
                      </a>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-subtle text-center text-[10px]">All times US Eastern.</p>
    </div>
  );
}
