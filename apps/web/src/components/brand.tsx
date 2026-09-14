import Image from "next/image";

import { cn } from "@/lib/utils";

const SIZES = {
  // The phone top bar, where the sidebar - and the mark in it - is off-canvas.
  sm: { px: 32, text: "text-base" },
  default: { px: 48, text: "text-xl" },
  lg: { px: 64, text: "text-3xl" },
} as const;

/** The mark and wordmark. One definition, used by the sidebar, the top bar and the login page. */
export function Brand({
  className,
  size = "default",
}: {
  className?: string;
  size?: keyof typeof SIZES;
}) {
  // The mark leads: well over the cap height, so it reads as the logo rather
  // than an inline glyph.
  const { px, text } = SIZES[size];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* Generated from branding/ by `npm run brand`. Decorative: the wordmark
          beside it already names the app. Eager: the mark sits at the top of
          every page, often as its largest paint. */}
      <Image
        src="/phoenix-avatar.png"
        alt=""
        width={px}
        height={px}
        loading="eager"
        className="shrink-0"
      />
      <span className={cn("font-semibold tracking-tight", text)}>
        {/* Stops sampled from the phoenix itself: its gold, orange and red. */}
        <span className="bg-linear-to-r from-[#f78d24] via-[#f4562c] to-[#d32127] bg-clip-text text-transparent">
          Phoenix
        </span>
        <span className="text-primary">Eye</span>
      </span>
    </span>
  );
}
