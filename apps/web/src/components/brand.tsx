import Image from "next/image";

import { cn } from "@/lib/utils";

/** Intrinsic size of public/phoenix-avatar.png, which `npm run brand` generates. */
const ART = { width: 640, height: 272 } as const;

/** CSS widths: the wordmark is wide, so it is sized by width and keeps its ratio. */
const SIZES = {
  // The phone top bar, where the sidebar - and the wordmark in it - is off-canvas.
  sm: 88,
  // The black top bar: 40px tall at the artwork's ratio.
  bar: 94,
  default: 184,
  lg: 224,
  x_lg: 300,
} as const;

/** The PhoeniX wordmark. One definition, used by the sidebar, the top bar and the login page. */
export function Brand({
  className,
  size = "x_lg",
}: {
  className?: string;
  size?: keyof typeof SIZES;
}) {
  const width = SIZES[size];
  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* Generated from branding/ by `npm run brand`. The artwork spells out
          the name, so the alt text carries it. Eager: the wordmark sits at the
          top of every page, often as its largest paint. */}
      <Image
        src="/phoenix-avatar.png"
        alt="PhoeniX"
        width={ART.width}
        height={ART.height}
        loading="eager"
        style={{ width, height: "auto" }}
        className="h-auto max-w-full shrink-0"
      />
    </span>
  );
}
