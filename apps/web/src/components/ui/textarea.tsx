import * as React from "react";
import { cn } from "cn";

/**
 * styleBar: "float" (default) gives the field the floating text-style bar on
 * focus (see components/text-style/text-styler); "inline" when the field shows
 * its own StyleBar, which keeps the shortcuts but not the floating copy; "off"
 * for none.
 */
function Textarea({
  className,
  styleBar = "float",
  ...props
}: React.ComponentProps<"textarea"> & { styleBar?: "float" | "inline" | "off" }) {
  return (
    <textarea
      data-slot="textarea"
      data-styled={styleBar === "off" ? undefined : styleBar}
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] leading-snug transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-[13px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
