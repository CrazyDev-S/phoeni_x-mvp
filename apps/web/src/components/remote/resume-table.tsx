"use client";

import {
  Briefcase,
  Download,
  ExternalLink,
  FileDown,
  FileType,
  Link2,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { Panel } from "@/components/panel";
import { usePdfDownload } from "@/components/remote/pdf-button";
import { Badge, badgeVariants } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadDocx } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A job the resume is linked to; only an application has an id to open. */
export interface LinkedJob {
  application_id: string | null;
  company_name: string | null;
  job_title: string | null;
  job_url: string | null;
}

export interface ResumeListItem {
  id: string;
  kind: "base" | "tailored";
  title: string;
  subtitle: string;
  tags: string[];
  status: string;
  createdAt: string;
  coverage: number | null;
  /** The resume's own page; null when there is nowhere to open. */
  href: string | null;
  linkedJobs: LinkedJob[];
}

const STATUS_BADGE: Record<string, "success" | "warning" | "secondary"> = {
  needs_review: "warning",
  final: "success",
  draft: "secondary",
};

const statusLabel = (status: string) => {
  const text = status.replace("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const jobName = (job: LinkedJob) =>
  [job.company_name, job.job_title].filter(Boolean).join(" - ") || "Job posting";

/** Opens the job's application, or the posting when it is only linked. */
function JobLink({ job, ...props }: { job: LinkedJob } & Omit<ComponentProps<"a">, "href">) {
  if (job.application_id) {
    return <Link href={`/remote/applications/${job.application_id}`} {...props} />;
  }
  return <a href={job.job_url ?? undefined} target="_blank" rel="noreferrer" {...props} />;
}

function LinkedJobs({ jobs }: { jobs: LinkedJob[] }) {
  if (jobs.length === 0) return <span className="text-subtle">-</span>;
  if (jobs.length === 1) {
    const [job] = jobs;
    return (
      <JobLink
        job={job}
        title={`Linked to ${jobName(job)}`}
        className="text-info inline-flex max-w-full items-center gap-1 hover:underline"
      >
        <Link2 className="size-3 shrink-0" />
        <span className="truncate">{job.company_name || job.job_title || "job"}</span>
      </JobLink>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Linked to ${jobs.length} jobs`}
        className={cn(badgeVariants({ variant: "info" }), "hover:bg-info/25")}
      >
        <Link2 />
        {jobs.length} linked jobs
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {jobs.map((job, index) => (
          <DropdownMenuItem key={job.application_id ?? job.job_url ?? index} asChild>
            <JobLink job={job}>
              {job.application_id ? <Briefcase /> : <ExternalLink />}
              <span className="truncate">{jobName(job)}</span>
            </JobLink>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({
  resume,
  onDelete,
}: {
  resume: ResumeListItem;
  onDelete?: (resume: ResumeListItem) => void;
}) {
  const pdf = usePdfDownload();
  const download = (profile: "designed" | "ats_plain") =>
    downloadDocx(
      { resume_id: resume.id, kind: resume.kind, profile },
      profile === "designed" ? `${resume.title}.docx` : `${resume.title}_ATS.docx`,
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${resume.title}`}
        className="text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted focus-visible:ring-ring/40 grid size-6 place-items-center rounded outline-none focus-visible:ring-2"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {resume.href && (
          <>
            <DropdownMenuItem asChild>
              <Link href={resume.href}>
                <ExternalLink />
                View
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={resume.href}>
                <Pencil />
                Edit
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href="/remote/tailor">
            <Sparkles />
            Tailor
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => download("designed")}>
          <Download />
          Download .docx
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pdf.busy}
          onSelect={() =>
            void pdf.download(
              { resume_id: resume.id, kind: resume.kind, profile: "designed" },
              `${resume.title}.pdf`,
              { announce: true },
            )
          }
        >
          <FileType />
          Download PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download("ats_plain")}>
          <FileDown />
          ATS version
        </DropdownMenuItem>
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(resume)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Every resume as one row: name, kind, what it targets, linked job, status, coverage, date. */
export function ResumeTable({
  resumes,
  onDelete,
}: {
  resumes: ResumeListItem[];
  onDelete?: (resume: ResumeListItem) => void;
}) {
  return (
    <Panel>
      <Table aria-label="Resumes">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[28%]">Name</TableHead>
            <TableHead className="w-20">Kind</TableHead>
            <TableHead>Target</TableHead>
            <TableHead className="w-44">Linked job</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-16 text-right">Coverage</TableHead>
            <TableHead className="w-28">Created</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resumes.map((resume) => (
            <TableRow key={`${resume.kind}-${resume.id}`}>
              <TableCell className="max-w-0 py-1">
                {resume.href ? (
                  <Link href={resume.href} className="block truncate font-semibold hover:underline">
                    {resume.title}
                  </Link>
                ) : (
                  <span className="block truncate font-semibold">{resume.title}</span>
                )}
              </TableCell>
              <TableCell className="py-1">
                <Badge variant={resume.kind === "tailored" ? "brand" : "secondary"}>
                  {resume.kind === "tailored" ? "Tailored" : "Base"}
                </Badge>
              </TableCell>
              <TableCell className="max-w-0 py-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-muted-foreground truncate text-xs">{resume.subtitle}</span>
                  {resume.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="outline" className="shrink-0">
                      {tag}
                    </Badge>
                  ))}
                  {resume.tags.length > 3 && (
                    <span className="text-subtle shrink-0 text-xs">+{resume.tags.length - 3}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-w-0 py-1 text-xs">
                <LinkedJobs jobs={resume.linkedJobs} />
              </TableCell>
              <TableCell className="py-1">
                <Badge variant={STATUS_BADGE[resume.status] ?? "secondary"}>
                  {statusLabel(resume.status)}
                </Badge>
              </TableCell>
              <TableCell className="py-1 text-right font-medium tabular-nums">
                {resume.coverage != null ? (
                  `${Math.round(resume.coverage)}%`
                ) : (
                  <span className="text-subtle">-</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground py-1 text-xs tabular-nums">
                <time dateTime={resume.createdAt}>{formatDateTime(resume.createdAt, "d MMM yyyy")}</time>
              </TableCell>
              <TableCell className="py-1 text-right">
                <RowMenu resume={resume} onDelete={onDelete} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground border-t px-3 py-1.5 text-xs tabular-nums">
        {resumes.length} {resumes.length === 1 ? "resume" : "resumes"}
      </p>
    </Panel>
  );
}
