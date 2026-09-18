import { Clock, Lightbulb, ShieldCheck, Star, Target, TrendingUp } from "lucide-react";

import { CheckList, PointList, SidePanel, type PointItem } from "@/components/side-panel";
import { StepsBand } from "@/components/steps-band";

const TIPS = [
  "Include the full job description, not just the title.",
  "Mention key skills and requirements.",
  "Be specific about your experience and achievements.",
  "Pick the base resume closest to the role.",
];

export function TipsPanel() {
  return (
    <SidePanel icon={Lightbulb} title="Tips for better results">
      <CheckList items={TIPS} />
    </SidePanel>
  );
}

const REASONS: PointItem[] = [
  {
    Icon: ShieldCheck,
    title: "ATS optimized",
    detail:
      "Coverage is counted from the parsed document, so the report cannot flatter it.",
  },
  {
    Icon: Target,
    title: "Tailored to the job",
    detail: "Employers, titles and dates are preserved — it reframes, it does not invent.",
  },
  {
    Icon: Clock,
    title: "Save time",
    detail: "No more manual editing and guessing at what the posting wants.",
  },
  {
    Icon: TrendingUp,
    title: "More interviews",
    detail: "Lead with the experience this specific role is actually asking for.",
  },
];

export function WhyPanel() {
  return (
    <SidePanel icon={Star} title="Why use Phoenix Eye?">
      <PointList items={REASONS} />
    </SidePanel>
  );
}

export function HowItWorks() {
  return (
    <StepsBand
      title="How it works"
      description="Get a tailored resume in 3 simple steps."
      steps={[
        {
          title: "Paste or choose",
          detail: "Add a job description and pick the base resume to work from.",
        },
        {
          title: "AI tailors your resume",
          detail: "We analyse the posting and reframe your experience against it.",
        },
        {
          title: "Download & apply",
          detail: "Take the .docx, or open the result and edit it first.",
        },
      ]}
    />
  );
}
