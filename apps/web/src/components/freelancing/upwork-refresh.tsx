"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { checkUpwork, type UpworkCheckOutcome } from "@/lib/extension-bridge";
import { cn } from "@/lib/utils";

const UPWORK_FIND_WORK = "https://www.upwork.com/nx/find-work/";
const EXTENSION_SETTINGS = "/settings?tab=extension";

function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * Refresh for the shared list. The list is only as fresh as what the extension
 * last collected, so this first has every Upwork search or feed open in this
 * browser refreshed now, waits for what those pages bring in, then reads the
 * list again and says what came in.
 */
export function UpworkRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function announce(outcome: UpworkCheckOutcome) {
    const settings = { label: "Extension settings", onClick: () => router.push(EXTENSION_SETTINGS) };
    if (outcome.kind === "absent") {
      toast("List refreshed", {
        description: "With the PhoeniX extension, Refresh also pulls new postings from the Upwork searches you have open.",
        action: { ...settings, label: "Get the extension" },
      });
      return;
    }
    if (outcome.kind === "failed") {
      toast.error("Could not refresh Upwork", { description: "The list was refreshed. Reload your Upwork tab and try again." });
      return;
    }

    const { lists, added, failed, paused, signedOut } = outcome.result;
    if (signedOut) {
      toast("Connect the extension", {
        description: "Paste a PhoeniX access token into the extension's Settings to collect postings.",
        action: settings,
      });
    } else if (paused) {
      toast("Collecting is paused", { description: "Resume it in the extension's Upwork tab, then refresh." });
    } else if (!lists) {
      toast("No Upwork search open", {
        description: "Open a search or your feed on Upwork. PhoeniX refreshes it every 5 minutes.",
        action: { label: "Open Upwork", onClick: () => window.open(UPWORK_FIND_WORK, "_blank", "noopener,noreferrer") },
      });
    } else if (failed === lists) {
      toast.error("Upwork did not come back", {
        description: `${lists === 1 ? "Your Upwork tab" : "Your Upwork tabs"} refreshed without showing postings. Check you are still signed in to Upwork.`,
      });
    } else {
      const checked = `Refreshed ${count(lists - failed, "Upwork tab")}.`;
      const missed = failed ? ` ${count(failed, "tab")} did not come through.` : "";
      if (added) toast.success(`${count(added, "new posting")} from Upwork`, { description: checked + missed });
      else toast("Up to date", { description: `${checked} Nothing new yet.${missed}` });
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      const outcome = await checkUpwork();
      await onRefresh();
      announce(outcome);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      onClick={() => void refresh()}
      disabled={busy}
      title="Refresh your open Upwork searches and collect new postings now"
    >
      <RefreshCw className={cn(busy && "animate-spin")} />
      {busy ? "Refreshing Upwork…" : "Refresh"}
    </Button>
  );
}
