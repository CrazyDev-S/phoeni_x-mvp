"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Permanent deletion, behind a confirmation that names what is about to go.
 *
 * Deleting a base resume can take tailored versions with it, so the API
 * refuses the first attempt and reports how many there are. That count is
 * shown here before the second, explicit confirmation - the user should never
 * discover the collateral damage afterwards.
 */
export function ConfirmDelete({
  label,
  onDelete,
  onDeleted,
  size = "default",
}: {
  label: string;
  /** Resolves when deleted; throws an ApiError the caller can inspect. */
  onDelete: (cascade: boolean) => Promise<void>;
  onDeleted?: () => void;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cascade, setCascade] = useState<{ message: string; count: number } | null>(null);

  async function run(withCascade: boolean) {
    setBusy(true);
    setError(null);
    try {
      await onDelete(withCascade);
      onDeleted?.();
      setOpen(false);
    } catch (err) {
      const e = err as {
        code?: string;
        message?: string;
        detail?: Record<string, unknown>;
      };
      if (e.code === "HAS_TAILORED_VERSIONS" && e.detail) {
        setCascade({
          message: String(e.detail.message ?? ""),
          count: Number(e.detail.tailored_count ?? 0),
        });
      } else {
        setError(e.message ?? "Could not delete");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCascade(null);
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size={size}>
          <Trash2 />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {cascade ? "This will delete more than one resume" : `Delete “${label}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {cascade
              ? `${cascade.message} This cannot be undone.`
              : "This permanently removes the resume. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <ErrorAlert>{error}</ErrorAlert>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={cn(buttonVariants({ variant: "destructive" }))}
            // The dialog stays open between the first refusal and the cascade
            // confirmation, so the default close-on-select is suppressed.
            onClick={(event) => {
              event.preventDefault();
              void run(Boolean(cascade));
            }}
          >
            {busy && <Spinner />}
            {cascade ? `Delete all ${cascade.count + 1}` : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
