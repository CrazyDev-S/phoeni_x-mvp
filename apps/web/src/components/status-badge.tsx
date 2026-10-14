import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";

/**
 * Outcome tones: neutral, passed, needs a look, failed, and the brand accent.
 * A thin map from the product's words to the badge variants.
 */
export type Tone = "neutral" | "ok" | "warn" | "bad" | "brand";

const TONE_VARIANT: Record<Tone, ComponentProps<typeof Badge>["variant"]> = {
  neutral: "secondary",
  ok: "success",
  warn: "warning",
  bad: "destructive",
  brand: "brand",
};

export function StatusBadge({
  tone = "neutral",
  ...props
}: Omit<ComponentProps<typeof Badge>, "variant"> & { tone?: Tone }) {
  return <Badge variant={TONE_VARIANT[tone]} {...props} />;
}
