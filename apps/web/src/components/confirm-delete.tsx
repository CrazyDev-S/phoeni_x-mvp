"use client";

import { useState } from "react";

import { Button, ErrorNote } from "./ui";

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
  size = "sm",
}: {
  label: string;
  /** Resolves when deleted; throws an ApiError the caller can inspect. */
  onDelete: (cascade: boolean) => Promise<void>;
  onDeleted?: () => void;
  size?: "sm" | "md";
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
      const e = err as { code?: string; message?: string; detail?: Record<string, unknown> };
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

  function reset() {
    setOpen(false);
    setCascade(null);
    setError(null);
  }

  if (!open) {
    return (
      <Button size={size} variant="ghost" onClick={() => setOpen(true)}>
        Delete
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--color-ink-soft)]">
        {cascade
          ? `${cascade.message} This cannot be undone.`
          : `Delete “${label}” permanently?`}
      </span>
      <Button
        size={size}
        variant="danger"
        loading={busy}
        onClick={() => run(Boolean(cascade))}
      >
        {cascade ? `Delete all ${cascade.count + 1}` : "Delete"}
      </Button>
      <Button size={size} variant="ghost" onClick={reset} disabled={busy}>
        Cancel
      </Button>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
