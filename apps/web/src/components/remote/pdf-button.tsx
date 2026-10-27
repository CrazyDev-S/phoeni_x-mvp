"use client";

import { FileType } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { downloadPdf } from "@/lib/api";

/**
 * Download a resume as PDF.
 *
 * The server converts the .docx, which takes a few seconds, so the caller can
 * show that something is happening and report a failure instead of swallowing it.
 */
export function usePdfDownload() {
  const [busy, setBusy] = useState(false);
  /** `announce` shows progress as a toast, for a trigger that closes on click (a menu item). */
  async function download(
    body: Record<string, unknown>,
    filename: string,
    { announce = false }: { announce?: boolean } = {},
  ) {
    setBusy(true);
    const notice = announce ? toast.loading("Making the PDF…") : undefined;
    try {
      await downloadPdf(body, filename);
    } catch (error) {
      toast.error((error as { message?: string }).message ?? "Could not make the PDF");
    } finally {
      if (notice !== undefined) toast.dismiss(notice);
      setBusy(false);
    }
  }
  return { busy, download };
}

export function PdfButton({
  body,
  filename,
  children = "Download PDF",
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "body"> & {
  body: Record<string, unknown>;
  filename: string;
}) {
  const { busy, download } = usePdfDownload();
  return (
    <Button {...props} disabled={disabled || busy} onClick={() => void download(body, filename)}>
      {busy ? <Spinner /> : <FileType />}
      {children}
    </Button>
  );
}
