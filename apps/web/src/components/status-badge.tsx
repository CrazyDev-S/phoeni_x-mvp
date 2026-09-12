import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Outcome tones.
 *
 * The neutral palette ships one semantic colour - destructive - but the app
 * also has to say "this passed" and "this needs a look". `success` and
 * `warning` are tokens defined next to `destructive` in globals.css, and are
 * tinted the same way the destructive badge variant is.
 */
export type Tone = "neutral" | "ok" | "warn" | "bad" | "brand";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "",
  ok: "bg-success/10 text-success dark:bg-success/20",
  warn: "bg-warning/10 text-warning dark:bg-warning/20",
  bad: "",
  brand: "",
};

const TONE_VARIANT: Record<Tone, ComponentProps<typeof Badge>["variant"]> = {
  neutral: "secondary",
  ok: "secondary",
  warn: "secondary",
  bad: "destructive",
  brand: "default",
};

export function StatusBadge({
  tone = "neutral",
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, "variant"> & { tone?: Tone }) {
  return (
    <Badge
      variant={TONE_VARIANT[tone]}
      className={cn(TONE_CLASS[tone], className)}
      {...props}
    />
  );
}
