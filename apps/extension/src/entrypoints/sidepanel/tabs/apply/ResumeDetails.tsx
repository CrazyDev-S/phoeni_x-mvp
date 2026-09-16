import { ChevronDown, FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { LinkedResume, ResumeFacts } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

/**
 * The linked resume's details, each one click from the clipboard.
 *
 * Whatever the filler could not place still has to be typed into the form,
 * and opening the downloaded .docx to copy a phone number out of it is the
 * step this saves.
 */
export function ResumeDetails({ resume }: { resume: LinkedResume }) {
  const [facts, setFacts] = useState<ResumeFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let live = true;
    setFacts(null);
    setError(null);
    api<{ facts: ResumeFacts }>(
      `/api/v1/extension/resume-facts?kind=${resume.kind}&resume_id=${resume.id}`,
    )
      .then((r) => live && setFacts(r.facts))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [resume.kind, resume.id]);

  const contact: [string, string | null][] = facts
    ? [
        ["Name", facts.full_name],
        ["Email", facts.email],
        ["Phone", facts.phone],
        ["Location", facts.location],
        ["LinkedIn", facts.linkedin],
        ["GitHub", facts.github],
        ["Website", facts.website],
        [
          "Current role",
          [facts.current_title, facts.current_company].filter(Boolean).join(" at ") || null,
        ],
        ["Experience", facts.years_experience ? `${facts.years_experience} years` : null],
        ["Availability", facts.availability],
      ]
    : [];
  const shown = contact.filter((row): row is [string, string] => Boolean(row[1]));
  const hasMore = Boolean(
    facts &&
      (facts.summary || facts.skills.length || facts.education.length || facts.languages.length),
  );

  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          <FileText className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <strong className="block text-xs">Resume details</strong>
            <p className="text-subtle truncate text-[10px]" title={resume.display_name}>
              {resume.display_name}
            </p>
          </div>
        </div>

        {error && <p className="text-destructive text-[11px]">{error}</p>}

        {!facts && !error && (
          <div className="space-y-1.5" aria-busy>
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        )}

        {facts && (
          <>
            <dl className="divide-y">
              {shown.map(([label, value]) => (
                <FactRow key={label} label={label} value={value} />
              ))}
            </dl>

            {hasMore && (
              <Collapsible open={more} onOpenChange={setMore}>
                <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 pt-1 text-[11px] font-medium">
                  <ChevronDown className={cn("size-3 transition-transform", more && "rotate-180")} />
                  Summary, skills and education
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <dl className="mt-1 divide-y">
                    {facts.summary && <FactRow label="Summary" value={facts.summary} long />}
                    {facts.skills.map((skill) => (
                      <FactRow key={skill.label} label={skill.label} value={skill.value} long />
                    ))}
                    {facts.education.map((entry) => (
                      <FactRow key={entry} label="Education" value={entry} long />
                    ))}
                    {facts.languages.length > 0 && (
                      <FactRow label="Languages" value={facts.languages.join(", ")} long />
                    )}
                  </dl>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FactRow({ label, value, long }: { label: string; value: string; long?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <dt className="text-subtle text-[10px]">{label}</dt>
        <dd
          className={cn("text-[11px]", long ? "line-clamp-3 leading-snug" : "truncate")}
          title={value}
        >
          {value}
        </dd>
      </div>
      <CopyButton text={value} label={label} />
    </div>
  );
}
