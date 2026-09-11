"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

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
  created_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  upload: "Uploaded",
  generated_story: "Generated · story",
  generated_job: "Generated · job",
  tailored_instruction: "Edited",
};

export default function ResumesPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["resumes", q],
    queryFn: () =>
      request<{ items: ResumeRow[]; total: number }>(
        `/api/v1/resumes?${new URLSearchParams(q ? { q } : {})}`,
      ),
  });

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

      <Input
        placeholder="Search resume text — try a skill, a company, a metric…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />

      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}

      <Card>
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-[var(--color-ink-soft)]">
            <Spinner /> Loading…
          </div>
        ) : !data?.items.length ? (
          <Empty
            title={q ? "Nothing matches that search" : "No resumes yet"}
            body={
              q
                ? "Full-text search covers the whole resume body, not just the title."
                : "Paste an existing resume, or generate one from a job description."
            }
            action={
              !q && (
                <Link href="/resumes/new">
                  <Button variant="primary">Create your first</Button>
                </Link>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {data.items.map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/resumes/${r.id}`}
                    className="font-medium hover:text-[var(--color-brand)]"
                  >
                    {r.display_name}
                  </Link>
                  <p className="truncate text-sm text-[var(--color-ink-soft)]">
                    {r.target_title}
                    {r.stack_tags.length > 0 && ` · ${r.stack_tags.slice(0, 4).join(", ")}`}
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
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
