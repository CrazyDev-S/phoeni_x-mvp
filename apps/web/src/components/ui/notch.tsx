import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The cut-out corner with its arrow button. Place it as the first child of a
 * `relative` card, and keep the card's text clear of it (about 4.5rem from the
 * right on the top rows). The cut reads as empty space because it is painted
 * in --notch, which defaults to the page canvas.
 *
 * With `href` the whole card should be the link: give the card an
 * `after:absolute after:inset-0` link, or wrap it - the notch itself is only
 * the visual cue and is not a second tab stop.
 */
export function Notch({
  className,
  children,
  tone = "light",
}: {
  className?: string;
  children?: ReactNode;
  /** light: a pale disc, for white or soft cards. dark: for charcoal and accent cards. */
  tone?: "light" | "dark";
}) {
  return (
    <span aria-hidden className={cn("notch", className)}>
      <span
        className={cn(
          "grid size-12 place-items-center rounded-full",
          tone === "light" ? "bg-soft-2 text-foreground" : "bg-white/15 text-current",
        )}
      >
        {children ?? <ArrowUpRight className="size-[18px]" />}
      </span>
    </span>
  );
}

/** A card-sized link whose stretched anchor covers the card, for use with <Notch/>. */
export function CardLink({
  className,
  ...props
}: ComponentProps<typeof Link>) {
  return <Link className={cn("outline-none after:absolute after:inset-0 after:z-1 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50", className)} {...props} />;
}
