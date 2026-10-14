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
        "inline-flex shrink-0 items-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-3.5 [&_svg]:shrink-0",
        size === "default" ? "h-11 px-5 text-[0.9rem]" : "h-9 px-4 text-[0.8125rem]",
        "bg-card/60 text-foreground/75 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.05)] hover:bg-card/90",
        "data-active:bg-primary data-active:text-primary-foreground data-active:shadow-none",
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
        "rounded-full bg-black/8 px-1.5 text-xs font-bold group-data-active:bg-white/20 [[data-active]_&]:bg-white/20",
        className,
      )}
      {...props}
    />
  );
}

function ChipRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}

export { Chip, ChipCount, ChipRow };
