import { CheckList } from "@/components/side-panel";
import { Card } from "@/components/ui/card";

const TIPS = [
  "Include the full job description, not just the title.",
  "Mention key skills and requirements.",
  "Be specific about your experience and achievements.",
  "Pick the base resume closest to the role.",
];

export function TipsPanel() {
  return (
    <Card tone="soft" className="gap-0 rounded-[2rem] p-6">
      <h2 className="mb-3.5 text-xl font-medium tracking-tight">Tips for better results</h2>
      <CheckList items={TIPS} />
    </Card>
  );
}
