"use client";

import {
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Folder,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Notch } from "@/components/ui/notch";
import { Ring } from "@/components/ui/ring";
import { Tile } from "@/components/tile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadDocx } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ResumeCardModel {
  id: string;
  kind: "base" | "tailored";
  title: string;
  subtitle: string;
  tags: string[];
  status: string;
  createdAt: string;
  coverage: number | null;
  /** The company a tailored resume targets; its initial leads the card. */
  company?: string | null;
  /** The resume's own page; null when there is nowhere to open. */
  href: string | null;
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

const MENU_ITEM =
  "h-10 gap-3 rounded-[14px] px-3 text-sm font-semibold [&_svg]:text-muted-foreground";

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
  const tailored = resume.kind === "tailored";
  const mark = (resume.company || resume.title).trim().charAt(0).toUpperCase();

  return (
    <Card
      tone={tailored ? "soft" : "default"}
      className="group min-h-[16.75rem] gap-0 p-6 transition-shadow duration-200 hover:shadow-md"
    >
      {resume.href && (
        <Notch
          className={cn("pointer-events-none", tailored && "[&>span]:bg-card")}
        />
      )}

      <div className="flex min-h-11 items-center gap-3">
        {tailored ? (
          <Tile tone="brand">{mark}</Tile>
        ) : (
          <Tile icon={FileText} tone="ink" />
        )}
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[0.78rem] font-bold">
          {tailored ? (
            <Sparkles className="size-3.5" />
          ) : (
            <Folder className="size-3.5" />
          )}
          {tailored ? "Tailored" : "Base"}
        </span>
      </div>

      <h3 className="mt-5 pr-10 text-[1.3rem] leading-[1.15] font-semibold tracking-tight text-balance">
        {resume.href ? (
          <Link
            href={resume.href}
            className="after:absolute after:inset-0 after:rounded-[inherit] hover:underline"
          >
            {resume.title}
          </Link>
        ) : (
          resume.title
        )}
      </h3>
      <p className="text-muted-foreground mt-1 truncate text-[0.8125rem] font-medium">
        {resume.subtitle}
      </p>

      <div className="mt-5 flex min-h-14 items-center">
        {resume.coverage != null ? (
          <div className="flex items-center gap-3.5">
            <Ring
              value={resume.coverage}
              size={56}
              className="[--ring-bg:var(--soft)]"
            />
            <div className="text-sm font-bold">Must-have coverage</div>
          </div>
        ) : resume.tags.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-1.5">
            {resume.tags.slice(0, 5).map((tag) => (
              <li key={tag}>
                <Badge
                  variant="outline"
                  className="h-[1.625rem] px-2.5 text-xs font-semibold"
                >
                  {tag}
                </Badge>
              </li>
            ))}
            {resume.tags.length > 5 && (
              <li className="text-subtle ml-0.5 self-center text-xs font-semibold">
                +{resume.tags.length - 5}
              </li>
            )}
          </ul>
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Badge variant={STATUS_BADGE[resume.status] ?? "secondary"}>
          {statusLabel(resume.status)}
        </Badge>
        <time
          dateTime={resume.createdAt}
          className="text-muted-foreground ml-auto text-[0.8125rem] font-semibold tabular-nums"
        >
          {formatDateTime(resume.createdAt, "d MMM yyyy")}
        </time>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${resume.title}`}
            className={cn(
              "bg-foreground/5 hover:bg-foreground/10 data-[state=open]:bg-primary data-[state=open]:text-primary-foreground focus-visible:ring-ring/40 relative z-10 grid size-[2.125rem] shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-3",
            )}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[13.5rem] rounded-[22px] p-2"
          >
            {resume.href && (
              <>
                <DropdownMenuItem asChild className={MENU_ITEM}>
                  <Link href={resume.href}>
                    <ExternalLink />
                    View
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className={MENU_ITEM}>
                  <Link href={resume.href}>
                    <Pencil />
                    Edit
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem asChild className={MENU_ITEM}>
              <Link href="/remote/tailor">
                <Sparkles />
                Tailor
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2 my-1.5" />
            <DropdownMenuItem
              className={MENU_ITEM}
              onSelect={() => download("designed")}
            >
              <Download />
              Download .docx
            </DropdownMenuItem>
            <DropdownMenuItem
              className={MENU_ITEM}
              onSelect={() => download("ats_plain")}
            >
              <FileDown />
              ATS version
            </DropdownMenuItem>
            {onDelete && (
              <>
                <DropdownMenuSeparator className="mx-2 my-1.5" />
                <DropdownMenuItem
                  variant="destructive"
                  className={MENU_ITEM}
                  onSelect={() => onDelete(resume)}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}
