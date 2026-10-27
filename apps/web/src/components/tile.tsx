import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A small rounded square holding one icon (or a letter): the leading mark of a row. */
export function Tile({
  icon: Icon,
  children,
  tone = "soft",
  size = "default",
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  children?: ReactNode;
  /** soft: the accent wash. brand: vivid. ink: charcoal with an accent icon. */
  tone?: "soft" | "brand" | "ink" | "neutral";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold",
        size === "sm" && "size-6 rounded text-[11px] [&_svg]:size-3.5",
        size === "default" && "size-7 rounded-md text-xs [&_svg]:size-4",
        size === "lg" && "size-9 rounded-md text-sm [&_svg]:size-[18px]",
        tone === "soft" && "bg-accent text-accent-foreground",
        tone === "brand" && "bg-brand text-brand-foreground",
        tone === "ink" && "bg-panel text-brand",
        tone === "neutral" && "bg-soft-2 text-foreground/70",
        className,
      )}
    >
      {Icon ? <Icon /> : children}
    </span>
  );
}
