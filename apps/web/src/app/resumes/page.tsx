"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { ConfirmDelete } from "@/components/confirm-delete";
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { downloadDocx, request } from "@/lib/api";

interface ResumeRow {
  id: string;
  display_name: string;
  target_title: string;
  stack_label: string | null;
  stack_tags: string[];
  source: string;
  mode: string;
  status: string;
  is_archived: boolean;
  created_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  upload: "Uploaded",
  generated_story: "Generated · story",
  generated_job: "Generated · job",
  tailored_instruction: "Edited",
};

interface TailoredRow {
  id: string;
  display_name: string;
  company_name: string | null;
  job_title: string | null;
  status: string;
  must_have_coverage_percent: number | null;
  created_at: string;
}

type View = "base" | "tailored" | "archived";

export default function ResumesPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("base");

  const { data, isLoading, error } = useQuery({
    queryKey: ["resumes", q, view],
    enabled: view !== "tailored",
    queryFn: () =>
      request<{ items: ResumeRow[]; total: number }>(
        `/api/v1/resumes?${new URLSearchParams({
          ...(q ? { q } : {}),
          ...(view === "archived" ? { include_archived: "true" } : {}),
        })}`,
      ),
  });

  const tailored = useQuery({
    queryKey: ["tailored-resumes", q],
    enabled: view === "tailored",
    queryFn: () =>
      request<{ items: TailoredRow[]; total: number }>(
        `/api/v1/tailored-resumes?${new URLSearchParams(q ? { q } : {})}`,
      ),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["resumes"] });
    queryClient.invalidateQueries({ queryKey: ["tailored-resumes"] });
  };

  const archive = useMutation({
    mutationFn: ({ id, restore }: { id: string; restore: boolean }) =>
      request(`/api/v1/resumes/${id}/${restore ? "restore" : "archive"}`, {
        method: "POST",
      }),
    onSuccess: refresh,
  });

  const rows =
    view === "archived"
      ? (data?.items ?? []).filter((r) => r.is_archived)
      : (data?.items ?? []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Resumes</h1>
          <p className="text-sm text-[var(--color-ink-soft)]">
            Base resumes you upload or generate. Tailored versions live with their
            applications.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/resumes/new">
            <Button variant="primary">New resume</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search resume text — try a skill, a company, a metric…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
        />
        <div className="flex gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
          {(
            [
              ["base", "Base"],
              ["tailored", "Tailored"],
              ["archived", "Archived"],
            ] as [View, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                view === key
                  ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]"
                  : "text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}

      <Card>
        {view === "tailored" ? (
          <TailoredList
            query={tailored}
            onDelete={(id) =>
              request(`/api/v1/tailored-resumes/${id}`, { method: "DELETE" })
            }
            onChanged={refresh}
          />
        ) : isLoading ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-[var(--color-ink-soft)]">
            <Spinner /> Loading…
          </div>
        ) : !rows.length ? (
          <Empty
            title={
              q
                ? "Nothing matches that search"
                : view === "archived"
                  ? "Nothing archived"
                  : "No resumes yet"
            }
            body={
              q
                ? "Full-text search covers the whole resume body, not just the title."
                : view === "archived"
                  ? "Archived resumes are hidden from the main list but kept."
                  : "Paste an existing resume, or generate one from a job description."
            }
            action={
              !q &&
              view === "base" && (
                <Link href="/resumes/new">
                  <Button variant="primary">Create your first</Button>
                </Link>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/resumes/${r.id}`}
                    className="font-medium hover:text-[var(--color-brand)]"
                  >
                    {r.display_name}
                  </Link>
                  <p className="truncate text-sm text-[var(--color-ink-soft)]">
                    {r.target_title}
                    {r.stack_tags.length > 0 &&
                      ` · ${r.stack_tags.slice(0, 4).join(", ")}`}
                  </p>
                </div>
                <Badge>{SOURCE_LABEL[r.source] ?? r.source}</Badge>
                {r.status === "needs_review" && <Badge tone="warn">Needs review</Badge>}
                {r.mode === "constructed" && <Badge tone="brand">Mode B</Badge>}
                <Button
                  size="sm"
                  onClick={() =>
                    downloadDocx(
                      { resume_id: r.id, kind: "base", profile: "designed" },
                      `${r.display_name}.docx`,
                    )
                  }
                >
                  .docx
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    archive.mutate({ id: r.id, restore: r.is_archived })
                  }
                >
                  {r.is_archived ? "Restore" : "Archive"}
                </Button>
                <ConfirmDelete
                  label={r.display_name}
                  onDelete={(cascade) =>
                    request(
                      `/api/v1/resumes/${r.id}${cascade ? "?cascade=true" : ""}`,
                      { method: "DELETE" },
                    )
                  }
                  onDeleted={refresh}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TailoredList({
  query,
  onDelete,
  onChanged,
}: {
  query: { data?: { items: TailoredRow[] }; isLoading: boolean };
  onDelete: (id: string) => Promise<unknown>;
  onChanged: () => void;
}) {
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-10 text-sm text-[var(--color-ink-soft)]">
        <Spinner /> Loading…
      </div>
    );
  }
  if (!query.data?.items.length) {
    return (
      <Empty
        title="No tailored versions yet"
        body="Tailoring a base resume against a job posting saves the result here."
      />
    );
  }
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {query.data.items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{r.display_name}</p>
            <p className="truncate text-sm text-[var(--color-ink-soft)]">
              {[r.company_name, r.job_title].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          {r.must_have_coverage_percent != null && (
            <Badge tone={r.must_have_coverage_percent >= 80 ? "ok" : "warn"}>
              {r.must_have_coverage_percent}% match
            </Badge>
          )}
          {r.status === "needs_review" && <Badge tone="warn">Needs review</Badge>}
          <Button
            size="sm"
            onClick={() =>
              downloadDocx(
                { resume_id: r.id, kind: "tailored", profile: "designed" },
                `${r.display_name}.docx`,
              )
            }
          >
            .docx
          </Button>
          <ConfirmDelete
            label={r.display_name}
            onDelete={() => onDelete(r.id).then(() => undefined)}
            onDeleted={onChanged}
          />
        </li>
      ))}
    </ul>
  );
}
