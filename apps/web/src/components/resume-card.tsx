"use client";

import {
  Download,
  ExternalLink,
  FileDown,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadDocx } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export interface ResumeCardModel {
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
}

const STATUS_TONE: Record<string, Tone> = {
  needs_review: "warn",
  final: "ok",
  draft: "neutral",
};

export function ResumeCard({
  resume,
  onDelete,
}: {
  resume: ResumeCardModel;
  onDelete?: (resume: ResumeCardModel) => void;
}) {
  const fileName = `${resume.title}.docx`;
  const download = (profile: "designed" | "ats_plain") =>
    downloadDocx(
      { resume_id: resume.id, kind: resume.kind, profile },
      profile === "designed" ? fileName : `${resume.title}_ATS.docx`,
    );

  return (
    <Card className="group relative gap-0 p-5 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="leading-snug font-semibold text-balance">
            {resume.href ? (
              <Link
                href={resume.href}
                className="after:absolute after:inset-0 hover:underline"
              >
                {resume.title}
              </Link>
            ) : (
              resume.title
            )}
          </h3>
          <p className="text-muted-foreground mt-1 truncate text-sm">{resume.subtitle}</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${resume.title}`}
              className="relative z-10 shrink-0"
            >
              <MoreHorizontal />
            </Button>
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
              <Link href="/tailor">
                <Sparkles />
                Tailor
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => download("designed")}>
              <Download />
              Download .docx
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
      </div>

      {resume.tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {resume.tags.slice(0, 5).map((tag) => (
            <li key={tag}>
              <StatusBadge tone="neutral">{tag}</StatusBadge>
            </li>
          ))}
          {resume.tags.length > 5 && (
            <li className="text-subtle self-center text-xs">+{resume.tags.length - 5}</li>
          )}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4">
        <StatusBadge
          tone={resume.kind === "tailored" ? "brand" : "neutral"}
          className="capitalize"
        >
          {resume.kind === "tailored" ? "Tailored" : "Base"}
        </StatusBadge>
        {resume.status !== "final" && (
          <StatusBadge tone={STATUS_TONE[resume.status] ?? "neutral"}>
            {resume.status.replace("_", " ")}
          </StatusBadge>
        )}
        {resume.coverage != null && (
          <span className="text-muted-foreground text-xs font-medium tabular-nums">
            {Math.round(resume.coverage)}% match
          </span>
        )}
        <time
          dateTime={resume.createdAt}
          className="text-subtle ml-auto text-xs tabular-nums"
        >
          {formatDateTime(resume.createdAt, "d MMM yyyy")}
        </time>
      </div>
    </Card>
  );
}
