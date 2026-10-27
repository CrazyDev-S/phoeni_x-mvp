import * as React from "react";
import { cn } from "cn";
import { Slot } from "radix-ui";

/**
 * A pill filter. Active chips go charcoal; the rest sit translucent on the
 * canvas. Renders a <button> by default, or its child with `asChild` (a link).
 */
function Chip({
  className,
  active = false,
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  active?: boolean;
  size?: "default" | "sm";
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="chip"
      data-active={active ? "" : undefined}
      aria-pressed={asChild ? undefined : active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3 [&_svg]:shrink-0",
        size === "default" ? "h-7 px-2.5 text-xs" : "h-6 px-2 text-xs",
        "border border-border bg-card text-foreground/80 hover:bg-muted",
        "data-active:border-primary data-active:bg-primary data-active:text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A small count inside a chip. */
function ChipCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "rounded bg-black/8 px-1 text-[11px] font-semibold tabular-nums group-data-active:bg-white/20 [[data-active]_&]:bg-white/20",
        className,
      )}
      {...props}
    />
  );
}

function ChipRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-1.5", className)} {...props} />;
}

export { Chip, ChipCount, ChipRow };
