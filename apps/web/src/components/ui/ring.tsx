import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/** A circular percentage: a conic arc around a number. */
export function Ring({
  value,
  size = 56,
  label,
  className,
  tone = "ink",
}: {
  /** 0-100. */
  value: number;
  size?: number;
  /** Shown in the middle; defaults to the value. */
  label?: string | number;
  className?: string;
  tone?: "ink" | "brand" | "success";
}) {
  const arc = { ink: "var(--primary)", brand: "var(--brand)", success: "var(--success)" }[tone];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span
      role="img"
      aria-label={`${pct}%`}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums",
        className,
      )}
      style={
        {
          width: size,
          height: size,
          background: `conic-gradient(${arc} ${pct}%, color-mix(in oklab, var(--foreground) 9%, transparent) 0)`,
          fontSize: Math.max(11, size * 0.25),
        } as CSSProperties
      }
    >
      <span
        aria-hidden
        className="absolute rounded-full bg-[var(--ring-bg,var(--card))]"
        style={{ inset: Math.max(5, size * 0.11) }}
      />
      <span className="relative">{label ?? Math.round(pct)}</span>
    </span>
  );
}
