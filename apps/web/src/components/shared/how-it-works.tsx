import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface HowStep {
  title: string;
  detail: string;
}

/** The numbered orientation card at the foot of an overview's side column. */
export function HowItWorks({ title, steps }: { title: string; steps: HowStep[] }) {
  return (
    <Card tone="soft">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-5">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3.5">
              <span className="bg-primary text-brand grid size-[34px] shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums">
                {index + 1}
              </span>
              <div>
                <p className="font-semibold">{step.title}</p>
                <p className="text-muted-foreground mt-0.5 text-[0.84rem] leading-snug">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
