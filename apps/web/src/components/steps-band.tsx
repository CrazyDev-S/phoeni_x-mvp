import { Card, CardContent } from "@/components/ui/card";

export interface Step {
  title: string;
  detail: string;
}

/**
 * The numbered band that closes a page.
 *
 * Dashed and tinted so it reads as orientation rather than as another piece of
 * the workspace above it.
 */
export function StepsBand({
  title,
  description,
  steps,
}: {
  title: string;
  description: string;
  steps: Step[];
}) {
  return (
    // Container queries, not viewport ones: this band sits in a main column
    // whose width depends on whether the page has an aside beside it.
    <Card className="bg-accent/40 @container border-dashed">
      <CardContent className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_2.2fr] @3xl:items-center">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        </div>

        <ol className="relative grid gap-6 @xl:grid-cols-3">
          {/* The connecting rule sits behind the numbers and only exists where
              the steps actually sit side by side. It runs centre to centre:
              each 2rem number sits at the start of its column, so the rule
              starts 1rem in and stops 1rem into the last of three columns
              (two 1.5rem gaps between them). */}
          <span
            aria-hidden
            className="bg-gradient-brand absolute top-4 right-[calc((100%_-_3rem)/3_-_1rem)] left-4 hidden h-px opacity-50 @xl:block"
          />
          {steps.map((step, index) => (
            <li key={step.title} className="relative space-y-1.5">
              <span className="bg-gradient-brand-strong text-primary-foreground relative flex size-8 items-center justify-center rounded-full text-xs font-semibold tabular-nums shadow-sm">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="pt-1 text-sm font-medium">{step.title}</p>
              <p className="text-muted-foreground text-xs leading-relaxed">{step.detail}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
