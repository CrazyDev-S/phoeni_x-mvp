import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";

/** The mark and wordmark. One definition, used by the sidebar and the login page. */
export function Brand({
  className,
  size = "default",
}: {
  className?: string;
  size?: "default" | "lg";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "bg-primary text-primary-foreground flex items-center justify-center rounded-lg",
          size === "lg" ? "size-10 [&_svg]:size-5" : "size-8 [&_svg]:size-4",
        )}
      >
        <FileText />
      </span>
      <span
        className={cn(
          "font-semibold tracking-tight",
          size === "lg" ? "text-xl" : "text-base",
        )}
      >
        Resume<span className="text-primary">Assist</span>
      </span>
    </span>
  );
}
