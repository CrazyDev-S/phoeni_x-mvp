"use client";

import { useQuery } from "@tanstack/react-query";
import { ListChecks, MessageSquareText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHero } from "@/components/page-hero";
import { CheckList, SidePanel } from "@/components/side-panel";
import { StepsBand } from "@/components/steps-band";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { request } from "@/lib/api";

/** GET /api/v1/shared/interview/status. */
interface InterviewStatus {
  available: boolean;
  planned: string[];
}

export default function InterviewPage() {
  // Purely informational: a missing endpoint just means no "Planned" panel.
  const status = useQuery({
    queryKey: ["shared", "interview", "status"],
    queryFn: () => request<InterviewStatus>("/api/v1/shared/interview/status"),
    retry: false,
  });
  const planned = Array.isArray(status.data?.planned) ? status.data.planned : [];

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Shared tool"
        eyebrowIcon={MessageSquareText}
        title="Interview Assist"
        description="Preparation notes, question banks and live assistance for every interview — for freelancing calls and remote-role loops alike."
      />

      <div
        className={cn(
          "grid gap-6 lg:items-start",
          planned.length > 0 && "lg:grid-cols-[minmax(0,1fr)_20rem]",
        )}
      >
        <div className="min-w-0 space-y-6">
          <Card className="gap-0 py-0">
            <CardContent className="px-0">
              <EmptyState
                icon={<MessageSquareText />}
                title="Not built yet"
                description="This shared tool is planned. Calendar and Job Maintenance already work across both categories."
              />
            </CardContent>
          </Card>

          <StepsBand
            title="What it will do"
            description="Before, during and after every call."
            steps={[
              {
                title: "Prepare",
                detail: "A brief for each call from the job, your resume or proposal, and the client.",
              },
              {
                title: "Assist",
                detail: "Live prompts and a question bank while the call is on.",
              },
              {
                title: "Review",
                detail: "Notes and follow-ups written back to the application or track.",
              },
            ]}
          />
        </div>

        {planned.length > 0 && (
          <aside className="space-y-6 lg:sticky lg:top-24">
            <SidePanel icon={ListChecks} title="Planned">
              <CheckList items={planned} />
            </SidePanel>
          </aside>
        )}
      </div>
    </div>
  );
}
