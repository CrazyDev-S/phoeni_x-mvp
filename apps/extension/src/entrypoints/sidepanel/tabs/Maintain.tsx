import { Briefcase, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyNote, Section } from "../chrome-shell";
import { ErrorNote } from "../components";

interface Job {
  id: string;
  employer_name: string;
  role_title: string;
  start_date: string;
  status: string;
  notes_markdown: string | null;
}

interface Series {
  id: string;
  title: string;
  recurrence_rule: string;
  start_time_local: string;
  is_active: boolean;
}

export function MaintainTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Job[]>("/api/v1/maintained-jobs")
      .then(setJobs)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    try {
      setSeries(await api<Series[]>(`/api/v1/maintained-jobs/${id}/series`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveNotes(id: string, notes: string) {
    try {
      await api(`/api/v1/maintained-jobs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes_markdown: notes }),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;

  if (!jobs.length) {
    return (
      <EmptyNote icon={Briefcase}>
        No maintained jobs yet. Promote an application once you have signed.
      </EmptyNote>
    );
  }

  return (
    <Section title={`${jobs.length} job${jobs.length === 1 ? "" : "s"}`}>
      <div className="space-y-2">
        {jobs.map((job) => (
          <Card key={job.id} className="py-0">
            <Collapsible open={open === job.id} onOpenChange={() => void toggle(job.id)}>
              <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-start gap-2 rounded-xl p-3 text-left transition-colors">
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs">{job.employer_name}</strong>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {job.role_title} · since {job.start_date}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "shrink-0",
                    job.status === "active" && "bg-success/10 text-success",
                  )}
                >
                  {job.status}
                </Badge>
                <ChevronDown
                  className={cn(
                    "text-muted-foreground mt-0.5 size-3.5 shrink-0 transition-transform",
                    open === job.id && "rotate-180",
                  )}
                />
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="space-y-2 border-t p-3">
                  <p className="text-muted-foreground text-[11px] font-medium">
                    Recurring meetings
                  </p>
                  <ul className="divide-y">
                    {series.length === 0 && (
                      <li className="text-muted-foreground py-1 text-[11px]">None yet.</li>
                    )}
                    {series.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 py-1 text-[11px]">
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {s.start_time_local}
                        </span>
                        {!s.is_active && <Badge variant="secondary">paused</Badge>}
                      </li>
                    ))}
                  </ul>
                  <Textarea
                    rows={3}
                    aria-label={`Notes for ${job.employer_name}`}
                    placeholder="Notes for this job…"
                    defaultValue={job.notes_markdown ?? ""}
                    onBlur={(e) => saveNotes(job.id, e.target.value)}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
      </div>
    </Section>
  );
}
