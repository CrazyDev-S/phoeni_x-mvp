"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  ListChecks,
  MessageSquareText,
  MessagesSquare,
  NotebookPen,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { PageHero } from "@/components/page-hero";
import { Tile } from "@/components/tile";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { request } from "@/lib/api";
import { portalPath, type PortalId } from "@/lib/portals";
import { cn } from "@/lib/utils";

/** GET /api/v1/shared/interview/status. */
interface InterviewStatus {
  available: boolean;
  planned: string[];
}

const STEPS: {
  when: string;
  title: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  {
    when: "Before the call",
    title: "Prepare",
    detail: "A brief for each call from the job, your resume or proposal, and the client.",
    icon: NotebookPen,
  },
  {
    when: "During the call",
    title: "Assist",
    detail: "Live prompts and a question bank while the call is on.",
    icon: MessagesSquare,
  },
  {
    when: "After the call",
    title: "Review",
    detail: "Notes and follow-ups written back to the application or track.",
    icon: ClipboardCheck,
  },
];

export function InterviewPage({ portal }: { portal: PortalId }) {
  // Purely informational: a missing endpoint just means no "Planned" panel.
  const status = useQuery({
    queryKey: ["shared", "interview", "status"],
    queryFn: () => request<InterviewStatus>("/api/v1/shared/interview/status"),
    retry: false,
  });
  const planned = Array.isArray(status.data?.planned) ? status.data.planned : [];

  return (
    <div className="space-y-7">
      <PageHero
        title="Interview Assist"
        badge={
          <Badge variant="brand" className="h-[34px] gap-2 px-4 text-[0.84rem]">
            <MessageSquareText />
            Coming soon
          </Badge>
        }
        description={
          portal === "freelancing"
            ? "Preparation notes, question banks and live assistance for every client call."
            : "Preparation notes, question banks and live assistance for every interview loop."
        }
      />

      <div
        className={cn(
          "grid gap-6 lg:items-start",
          planned.length > 0 && "lg:grid-cols-[minmax(0,1fr)_21.25rem]",
        )}
      >
        <div className="min-w-0 space-y-[34px]">
          <Card className="grid gap-10 p-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-center lg:py-[38px] lg:pr-[34px] lg:pl-[38px]">
            <div>
              <Tile icon={MessageSquareText} tone="ink" size="lg" className="mb-[26px] [&_svg]:size-6" />
              <h2 className="text-[2.5rem] leading-[1.05] font-normal tracking-tight">
                Not built yet
              </h2>
              <p className="text-muted-foreground mt-3 max-w-[22.5rem] text-base leading-normal font-medium">
                This tool is planned. Calendar and Job Maintenance already work in this portal.
              </p>
            </div>
            <ul className="bg-soft flex flex-col gap-1.5 rounded-[28px] p-2.5">
              <AvailableRow
                icon={CalendarDays}
                name="Calendar"
                detail="Your schedule"
                href={portalPath(portal, "calendar")}
              />
              <AvailableRow
                icon={Wrench}
                name="Job maintenance"
                detail="Jobs and recurring meetings"
                href={portalPath(portal, "maintenance")}
              />
              <li className="shadow-[inset_0_0_0_1.5px_var(--border)] flex items-center gap-3.5 rounded-[20px] py-3 pr-3 pl-3.5">
                <Tile icon={MessageSquareText} tone="neutral" />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.97rem] font-semibold">Interview Assist</p>
                  <p className="text-muted-foreground text-sm font-medium">This tool</p>
                </div>
                <Badge variant="outline" className="mr-1.5">
                  Planned
                </Badge>
              </li>
            </ul>
          </Card>

          <section className="space-y-[18px]">
            <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
              <h2 className="text-[1.625rem] font-medium tracking-tight">What it will do</h2>
              <p className="text-muted-foreground text-[0.9rem] font-medium">
                Before, during and after every call.
              </p>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map(({ when, title, detail, icon: Icon }, index) => (
                <li key={title} className="flex">
                  <Card tone="soft" className="w-full gap-0 rounded-[30px] px-6 pt-6 pb-[26px]">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground/85 text-[3.25rem] leading-none font-light tracking-tight tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Tile icon={Icon} tone="neutral" size="lg" className="bg-card text-foreground" />
                    </div>
                    <Badge variant="secondary" className="bg-card mt-11 self-start">
                      {when}
                    </Badge>
                    <h3 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h3>
                    <p className="text-muted-foreground mt-2 text-[0.9rem] leading-normal font-medium">
                      {detail}
                    </p>
                  </Card>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {planned.length > 0 && (
          <aside className="lg:sticky lg:top-24">
            <Card tone="dark" className="gap-0 rounded-[2.25rem] px-6 pt-[26px] pb-7">
              <div className="mb-[22px] flex items-center gap-3">
                <Tile icon={ListChecks} tone="neutral" className="bg-panel-raised text-panel-foreground size-9 rounded-full" />
                <h2 className="text-2xl font-medium tracking-tight">Planned</h2>
              </div>
              <ul className="space-y-[18px]">
                {planned.map((item, index) => (
                  <li
                    key={item}
                    className={cn(
                      "text-panel-foreground/85 flex items-start gap-3.5 text-[0.875rem] leading-snug font-medium",
                      index > 0 && "border-panel-muted/30 border-t pt-[18px]",
                    )}
                  >
                    <span
                      aria-hidden
                      className="mt-px size-6 shrink-0 rounded-full shadow-[inset_0_0_0_1.6px_var(--panel-muted)]"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}

/** A tool that already works in this portal, linking to its page. */
function AvailableRow({
  icon,
  name,
  detail,
  href,
}: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  detail: string;
  href: string;
}) {
  return (
    <li className="bg-card flex items-center gap-3 rounded-[20px] py-3 pr-3 pl-3.5">
      <Tile icon={icon} />
      <div className="min-w-0 flex-1">
        <p className="text-[0.97rem] font-semibold">{name}</p>
        <p className="text-muted-foreground text-[0.8125rem] font-medium">{detail}</p>
      </div>
      <Badge variant="success">Working</Badge>
      <Link
        href={href}
        aria-label={`Open ${name}`}
        className="bg-foreground/6 hover:bg-foreground/10 grid size-9 shrink-0 place-items-center rounded-full transition-colors"
      >
        <ArrowUpRight className="size-4" />
      </Link>
    </li>
  );
}
