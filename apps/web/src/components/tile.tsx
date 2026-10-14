import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A rounded square holding one icon (or a letter): the leading mark of a row or card. */
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
        "flex shrink-0 items-center justify-center font-bold",
        size === "sm" && "size-9 rounded-xl [&_svg]:size-4",
        size === "default" && "size-11 rounded-[14px] [&_svg]:size-[18px]",
        size === "lg" && "size-14 rounded-[18px] [&_svg]:size-6",
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
