import { Check } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** The supporting column: a card led by one icon in a tinted square. */
export function SidePanel({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
        <span className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A checklist. Advice, where each line stands on its own. */
export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm">
          <Check className="text-success mt-0.5 size-4 shrink-0" />
          <span className="text-muted-foreground leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export interface PointItem {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
}

/** A list where each entry is a named idea rather than a single sentence. */
export function PointList({ items }: { items: PointItem[] }) {
  return (
    <ul className="space-y-4">
      {items.map(({ Icon, title, detail }) => (
        <li key={title} className="flex gap-3">
          <span className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
            <Icon className="size-4" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">{detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Label/value rows, for a panel that reports rather than advises. */
export function FactList({
  items,
}: {
  items: { label: string; value: ReactNode; tone?: "default" | "muted" }[];
}) {
  return (
    <dl className="space-y-3">
      {items.map(({ label, value, tone }) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd
            className={cn(
              "text-sm font-medium tabular-nums",
              tone === "muted" && "text-muted-foreground font-normal",
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
