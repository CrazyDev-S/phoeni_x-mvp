"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { NextCallBanner } from "@/components/next-call";
import { Badge, Button, Card, Empty, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { request } from "@/lib/api";
import { APP_TZ, fmtDay, fmtTime } from "@/lib/format";

interface Meeting {
  id: string;
  title: string;
  meeting_type: string;
  starts_at: string;
  ends_at: string;
  display_tz: string;
  status: string;
  conferencing_url: string | null;
  agenda: string | null;
  preparation_notes: string | null;
  notes: string | null;
  series_id: string | null;
  is_exception: boolean;
}

const STATUSES = ["scheduled", "held", "cancelled", "rescheduled", "no_show"];

function startOfWeek(d: Date) {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // Monday-first
  copy.setDate(copy.getDate() - day);
  return copy;
}

export default function CalendarPage() {
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [selected, setSelected] = useState<Meeting | null>(null);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(anchor);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [anchor],
  );
  const from = days[0].toISOString().slice(0, 10);
  const to = days[6].toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["meetings", from, to],
    queryFn: () => request<Meeting[]>(`/api/v1/meetings?from=${from}&to=${to}`),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      request<Meeting>(`/api/v1/meetings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (m) => {
      setSelected(m);
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["next-call"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of data ?? []) {
      const key = fmtDay(m.starts_at);
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return map;
  }, [data]);

  return (
    <div className="space-y-4">
      <NextCallBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="text-sm text-[var(--color-ink-soft)]">
            All times in US Eastern ({APP_TZ}) — the zone is derived from the
            instant, so it reads EST in winter and EDT in summer.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAnchor((a) => new Date(a.getTime() - 7 * 864e5))}>
            ← Previous
          </Button>
          <Button onClick={() => setAnchor(startOfWeek(new Date()))}>This week</Button>
          <Button onClick={() => setAnchor((a) => new Date(a.getTime() + 7 * 864e5))}>
            Next →
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-[var(--color-ink-soft)]">
            <Spinner /> Loading…
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-7">
          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            const items = byDay.get(key) ?? [];
            const isToday = key === new Date().toISOString().slice(0, 10);
            return (
              <Card key={key} className={isToday ? "border-[var(--color-brand)]" : ""}>
                <div className="border-b border-[var(--color-line)] px-3 py-2">
                  <p className="text-xs text-[var(--color-ink-soft)]">
                    {d.toLocaleDateString(undefined, { weekday: "short" })}
                  </p>
                  <p className="text-sm font-medium">
                    {d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </p>
                </div>
                <ul className="min-h-20 space-y-1 p-2">
                  {items.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => setSelected(m)}
                        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-canvas)] ${
                          m.status === "cancelled"
                            ? "border-[var(--color-line)] line-through opacity-60"
                            : "border-[var(--color-brand)] bg-[var(--color-brand-soft)]"
                        }`}
                      >
                        <span className="block font-medium">{fmtTime(m.starts_at)}</span>
                        <span className="block truncate">{m.title}</span>
                      </button>
                    </li>
                  ))}
                  {!items.length && (
                    <li className="px-2 py-1 text-xs text-[var(--color-ink-soft)]">—</li>
                  )}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {selected && (
        <Card title={selected.title} action={<Badge>{selected.status}</Badge>}>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-ink-soft)]">
                {fmtDay(selected.starts_at)} · {fmtTime(selected.starts_at)}–
                {fmtTime(selected.ends_at)} ({selected.display_tz})
                {selected.series_id && (
                  <> · recurring{selected.is_exception ? ", edited" : ""}</>
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Move to date">
                  <Input
                    type="date"
                    defaultValue={fmtDay(selected.starts_at)}
                    onChange={(e) =>
                      patch.mutate({ id: selected.id, body: { local_date: e.target.value } })
                    }
                  />
                </Field>
                <Field label="Time (Eastern)">
                  <Input
                    type="time"
                    defaultValue={fmtTime(selected.starts_at)}
                    onChange={(e) =>
                      patch.mutate({ id: selected.id, body: { local_time: e.target.value } })
                    }
                  />
                </Field>
              </div>
              <Field label="Status">
                <Select
                  value={selected.status}
                  onChange={(e) =>
                    patch.mutate({ id: selected.id, body: { status: e.target.value } })
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace("_", " ")}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="space-y-3">
              <Field label="Preparation">
                <Textarea
                  rows={4}
                  defaultValue={selected.preparation_notes ?? ""}
                  onBlur={(e) =>
                    patch.mutate({ id: selected.id, body: { preparation_notes: e.target.value } })
                  }
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  rows={4}
                  defaultValue={selected.notes ?? ""}
                  onBlur={(e) => patch.mutate({ id: selected.id, body: { notes: e.target.value } })}
                />
              </Field>
            </div>
          </div>
        </Card>
      )}

      {!isLoading && !data?.length && (
        <Card>
          <Empty
            title="Nothing scheduled this week"
            body="Meetings appear here when you schedule an interview stage or create a recurring team meeting."
          />
        </Card>
      )}
    </div>
  );
}
