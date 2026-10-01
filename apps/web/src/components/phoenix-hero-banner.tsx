import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PhoenixHeroBannerProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  stats?: ReactNode;
  quote?: string;
  badge?: ReactNode;
  className?: string;
}

export function PhoenixHeroBanner({
  eyebrow,
  title,
  description,
  actions,
  stats,
  quote,
  badge,
  className,
}: PhoenixHeroBannerProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-orange-200/60 bg-gradient-to-r from-amber-50/70 via-orange-50/40 to-amber-100/30 p-6 md:p-8 dark:border-orange-950/40 dark:from-stone-900 dark:via-orange-950/20 dark:to-stone-900 shadow-sm transition-all",
        className,
      )}
    >
      {/* Decorative Background Artwork: Sunrise mountains & Soaring Phoenix */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-full max-w-xl overflow-hidden opacity-85 dark:opacity-40">
        <svg
          className="absolute right-0 top-1/2 -translate-y-1/2 h-[130%] w-auto select-none"
          viewBox="0 0 600 240"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="sunGlow" x1="450" y1="50" x2="450" y2="240" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f59e0b" stopOpacity="0.4" />
              <stop offset="0.5" stopColor="#ea580c" stopOpacity="0.2" />
              <stop offset="1" stopColor="#dc2626" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="phoenixFlame" x1="400" y1="20" x2="520" y2="140" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fbbf24" />
              <stop offset="0.4" stopColor="#f97316" />
              <stop offset="0.8" stopColor="#ef4444" />
              <stop offset="1" stopColor="#b91c1c" />
            </linearGradient>
            <linearGradient id="mountainFar" x1="300" y1="120" x2="500" y2="240" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fed7aa" stopOpacity="0.5" />
              <stop offset="1" stopColor="#fb923c" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="mountainClose" x1="350" y1="140" x2="600" y2="240" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f97316" stopOpacity="0.35" />
              <stop offset="1" stopColor="#c2410c" stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* Sun Rays & Glow */}
          <circle cx="460" cy="90" r="100" fill="url(#sunGlow)" />
          <circle cx="460" cy="90" r="45" fill="#fef3c7" fillOpacity="0.6" />

          {/* Layered Mountains */}
          <path
            d="M260 240 L340 145 L410 185 L480 130 L550 175 L620 120 L650 240 Z"
            fill="url(#mountainFar)"
          />
          <path
            d="M320 240 L390 170 L460 210 L520 155 L600 220 L640 180 L660 240 Z"
            fill="url(#mountainClose)"
          />

          {/* Soaring Majestic Phoenix Art */}
          <g transform="translate(420, 45) scale(0.65)">
            {/* Wings & Feathers */}
            <path
              d="M60 70 C40 40, 10 20, -50 15 C-20 35, -5 55, 10 75 C-30 65, -70 60, -110 70 C-75 85, -45 95, -15 100 C-50 100, -85 105, -115 120 C-80 125, -40 125, -5 118 C20 115, 45 95, 60 70 Z"
              fill="url(#phoenixFlame)"
              opacity="0.95"
            />
            <path
              d="M60 70 C75 40, 105 20, 160 10 C135 30, 120 50, 105 70 C145 60, 185 55, 225 65 C190 80, 160 90, 130 95 C165 95, 200 100, 230 115 C195 120, 155 120, 120 115 C95 110, 75 92, 60 70 Z"
              fill="url(#phoenixFlame)"
              opacity="0.95"
            />
            {/* Phoenix Head & Crown */}
            <path
              d="M60 70 C62 55, 68 45, 75 35 C78 30, 80 20, 78 15 C72 18, 68 25, 65 32 C62 25, 58 18, 52 14 C54 22, 57 30, 58 38 C52 45, 56 60, 60 70 Z"
              fill="#fbbf24"
            />
            <circle cx="68" cy="38" r="2.5" fill="#78350f" />
            {/* Flowing Tail Feathers */}
            <path
              d="M60 95 C55 130, 45 165, 15 195 C35 170, 50 140, 58 110 Z"
              fill="url(#phoenixFlame)"
              opacity="0.9"
            />
            <path
              d="M60 95 C65 135, 75 175, 105 205 C85 180, 70 145, 62 110 Z"
              fill="url(#phoenixFlame)"
              opacity="0.9"
            />
            <path
              d="M60 98 C60 140, 60 180, 60 215 C58 185, 58 150, 60 112 Z"
              fill="#f59e0b"
              opacity="0.85"
            />
          </g>
        </svg>
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            {eyebrow && (
              <div className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400">
                {eyebrow}
              </div>
            )}
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-extrabold tracking-tight text-stone-900 dark:text-stone-100">
              {title}
            </h1>
          </div>
          {badge && <div>{badge}</div>}
        </div>

        {description && (
          <p className="mt-2 text-sm md:text-base text-stone-600 dark:text-stone-300 max-w-2xl font-normal leading-relaxed">
            {description}
          </p>
        )}

        {quote && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-700 dark:text-orange-300">
            <span className="italic">“{quote}”</span>
          </div>
        )}

        {actions && <div className="mt-4 flex flex-wrap items-center gap-2.5">{actions}</div>}

        {stats && <div className="mt-6">{stats}</div>}
      </div>
    </div>
  );
}
