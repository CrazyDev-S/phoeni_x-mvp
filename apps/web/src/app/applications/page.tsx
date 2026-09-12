"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { NextCallBanner } from "@/components/next-call";
import { Badge, Button, Card, Empty, Select, Spinner } from "@/components/ui";
import { request } from "@/lib/api";
import { formatDateTime, IMMINENT_MINUTES } from "@/lib/format";

interface Stage {
  id: string;
  seq: number;
  name: string;
  kind: string;
  status: string;
  scheduled_for: string | null;
}

interface Row {
  id: string;
  company_name: string;
  role_title: string;
  job_url: string | null;
  status: string;
  stage_count: number;
  stages_passed: number;
  must_have_coverage_percent: number | null;
  current_stage: Stage | null;
  next_meeting: { id: string; starts_at: string; title: string } | null;
}

const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "brand"> = {
  saved: "neutral", applied: "brand", in_process: "brand",
  offer: "ok", hired: "ok", rejected: "bad", withdrawn: "neutral", ghosted: "warn",
};

export default function ApplicationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["applications", filter],
    queryFn: () =>
      request<{ items: Row[]; total: number }>(
        `/api/v1/applications${filter ? `?status=${filter}` : ""}`,
      ),
  });

  const setStage = useMutation({
    mutationFn: ({ stageId, status }: { stageId: string; status: string }) =>
      request<{ suggested_next_stage: { name: string } | null }>(
        `/api/v1/stages/${stageId}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      ),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["next-call"] });
      if (res.suggested_next_stage) {
        setPrompt(`Passed. Next up: ${res.suggested_next_stage.name} — schedule it?`);
      }
    },
  });
  const [prompt, setPrompt] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <NextCallBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Applications</h1>
          <p className="text-sm text-[var(--color-ink-soft)]">
            Every saved application, its current stage, and the next call.
          </p>
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48">
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </Select>
      </div>

      {prompt && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-4 py-3 text-sm">
          <span>{prompt}</span>
          <Link href="/calendar" className="ml-auto">
            <Button size="sm" variant="primary">Open calendar</Button>
          </Link>
          <button onClick={() => setPrompt(null)} className="text-[var(--color-ink-soft)]">
            Dismiss
          </button>
        </div>
      )}

      <Card>
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-[var(--color-ink-soft)]">
            <Spinner /> Loading…
          </div>
        ) : !data?.items.length ? (
          <Empty
            title="No applications yet"
            body="Save one after tailoring a resume — from the portal or the extension."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-soft)]">
                <tr>
                  {["Company", "Role", "Status", "Progress", "Current stage", "Next call", "Match", ""].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.items.map((r) => {
                  const soon =
                    r.next_meeting &&
                    (new Date(r.next_meeting.starts_at).getTime() - Date.now()) / 60000 <=
                      IMMINENT_MINUTES;
                  return (
                    <tr key={r.id} className={soon ? "bg-[var(--color-brand-soft)]/40" : ""}>
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/applications/${r.id}`} className="hover:text-[var(--color-brand)]">
                          {r.company_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-ink-soft)]">{r.role_title}</td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>
                          {r.status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-ink-soft)]">
                        {r.stages_passed}/{r.stage_count}
                      </td>
                      <td className="px-4 py-3">{r.current_stage?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        {r.next_meeting ? (
                          <span className={soon ? "font-medium text-[var(--color-brand)]" : ""}>
                            {formatDateTime(r.next_meeting.starts_at, "d MMM HH:mm zzz")}
                          </span>
                        ) : (
                          <span className="text-[var(--color-ink-soft)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-ink-soft)]">
                        {r.must_have_coverage_percent != null ? `${r.must_have_coverage_percent}%` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r.current_stage && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              onClick={() =>
                                setStage.mutate({ stageId: r.current_stage!.id, status: "passed" })
                              }
                            >
                              Passed
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                setStage.mutate({ stageId: r.current_stage!.id, status: "failed" })
                              }
                            >
                              Failed
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
