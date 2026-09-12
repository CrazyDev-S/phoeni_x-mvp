"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const SIZE = 96;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A percentage, drawn as a ring that fills from zero on mount.
 *
 * The number is repeated as text in the middle, so the reading never depends
 * on judging an arc - or on seeing colour at all.
 */
export function ScoreRing({
  value,
  label,
  tone = "primary",
}: {
  value: number | null;
  label: string;
  tone?: "primary" | "success" | "info";
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (value === null) return;
    // One frame at zero, so the stroke has something to transition from.
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  const stroke = {
    primary: "stroke-primary",
    success: "stroke-success",
    info: "stroke-info",
  }[tone];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          aria-hidden
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-muted"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(Math.max(shown, 0), 100) / 100)}
            className={cn(stroke, "transition-[stroke-dashoffset] duration-700 ease-out")}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums">
          {value === null ? "—" : `${Math.round(value)}%`}
        </span>
      </div>
      <span className="text-muted-foreground text-center text-xs font-medium">{label}</span>
    </div>
  );
}
