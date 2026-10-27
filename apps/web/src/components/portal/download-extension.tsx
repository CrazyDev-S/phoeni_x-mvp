"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Puzzle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Bytes as the rounded unit a download dialog would show. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}

/**
 * The packaged browser extension.
 *
 * The portal serves whatever `npm run zip:ext` last built, so the button
 * reports the real size and reads as unavailable - rather than 404-ing - when
 * nothing has been packaged yet.
 */
export interface PackageStatus {
  available: boolean;
  bytes?: number;
  builtAt?: string;
  /** Where the server looked, when it found nothing. */
  searched?: string;
}

/** The packaged extension's status; the same request wherever it is shown. */
export function useExtensionPackage() {
  return useQuery({
    queryKey: ["extension-package"],
    queryFn: async () => {
      const res = await fetch("/api/extension", { cache: "no-store" });
      if (!res.ok)
        throw new Error(`The portal answered ${res.status} for /api/extension`);
      return (await res.json()) as PackageStatus;
    },
    // A found package is stable; anything else is re-checked on every focus, so
    // packaging the extension needs no reload to show up.
    staleTime: (query) => (query.state.data?.available ? 5 * 60_000 : 0),
    retry: false,
  });
}

export function DownloadExtension({
  className,
  showSize = true,
}: {
  className?: string;
  /** The size beside the label; off where the size is stated next to the button. */
  showSize?: boolean;
}) {
  const { data, isLoading, isError, error, refetch } = useExtensionPackage();

  if (isLoading) return <Skeleton className="h-8 w-40" />;

  // The check itself failed: say so, and let the user try again.
  if (isError) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            className={className}
            onClick={() => refetch()}
          >
            <Puzzle />
            Couldn’t check — retry
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {(error as Error).message}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!data?.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="block rounded-md">
            <Button
              variant="secondary"
              disabled
              className={className}
            >
              <Puzzle />
              Browser extension
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          Not packaged yet — run{" "}
          <code className="font-mono">npm run zip:ext</code>
          {data?.searched && (
            <span className="mt-1 block break-all opacity-80">
              Looked in {data.searched}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      asChild
      variant="secondary"
      className={className}
      title={`Packaged ${new Date(data.builtAt!).toLocaleDateString()}`}
    >
      {/* A real navigation, not fetch + object URL: the browser owns the save
          dialog and the download survives leaving this page. */}
      <a href="/api/extension/download" download>
        <Download />
        Download extension
        {showSize && (
          <span className="text-subtle ml-1 text-xs tabular-nums">
            {formatBytes(data.bytes!)}
          </span>
        )}
      </a>
    </Button>
  );
}
