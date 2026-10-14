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
  tone = "default",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
  className?: string;
  tone?: "default" | "soft" | "dark";
}) {
  return (
    <Card tone={tone} className={className}>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            tone === "dark" ? "bg-panel-raised text-panel-foreground" : "bg-accent text-accent-foreground",
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <CardTitle>{title}</CardTitle>
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
          <span className="bg-primary text-brand mt-0.5 grid size-5 shrink-0 place-items-center rounded-md"><Check className="size-3 stroke-[3]" /></span>
          <span className="text-foreground/80 leading-snug font-medium">{item}</span>
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
          <span className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
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
