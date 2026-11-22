"use client";

import { Link2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { request } from "@/lib/api";
import { readUpworkProfile, type ProfileRead } from "@/lib/extension-bridge";
import type { PortfolioItem, SpecializedProfile } from "@/lib/freelancing";

/** The form's fields as read off a profile's Upwork pages. Nothing is saved yet. */
export interface FreelancerProfileDraft {
  name: string | null;
  title: string | null;
  overview: string | null;
  hourly_rate: number | null;
  skills: string[];
  portfolio: PortfolioItem[];
  specialized_profiles: SpecializedProfile[];
  raw_profile_markdown: string | null;
}

// /freelancers/~01abc or /freelancers/name, /fl/name, and the old /o/profiles/users/~01abc.
const PROFILE_PATH = /^\/(freelancers|fl)\/[^/]+\/?$|^\/o\/profiles\/users\/[^/]+\/?$/i;
const EXTENSION_SETTINGS = "/settings?tab=extension";

/** The profile link in what someone typed or pasted, as a full URL; null when it is not one. */
export function profileLink(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/(^|\.)upwork\.com$/i.test(url.hostname) || !PROFILE_PATH.test(url.pathname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type Phase = "idle" | "reading" | "filling";
const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  reading: "Reading Upwork…",
  filling: "Filling in…",
};

type NotRead = Extract<ProfileRead, { ok: false }>["reason"];
const NOT_READ: Record<NotRead, { title: string; description: string; openLink?: boolean }> = {
  "not-a-profile": {
    title: "That link is not a profile",
    description: "Use the address of a freelancer's profile page on Upwork.",
  },
  "signed-out": {
    title: "Sign in to Upwork first",
    description: "Upwork showed its sign-in page. Sign in in this browser, then fill again.",
    openLink: true,
  },
  blocked: {
    title: "Upwork wants a quick check",
    description: "Open the profile in a tab, pass Upwork's check, then fill again.",
    openLink: true,
  },
  unreadable: {
    title: "The profile did not load",
    description: "Check the link opens in this browser, then fill again.",
    openLink: true,
  },
};

function count(n: number, one: string): string | null {
  return n ? `${n} ${one}${n === 1 ? "" : "s"}` : null;
}

/** "Title, overview, $65/hr, 24 skills and notes": what a fill brought in. */
function summary(draft: FreelancerProfileDraft): string {
  const parts = [
    draft.title && "title",
    draft.overview && "overview",
    draft.hourly_rate != null && `$${draft.hourly_rate}/hr`,
    count(draft.skills.length, "skill"),
    count(draft.portfolio.length, "portfolio item"),
    count(draft.specialized_profiles.length, "specialized profile"),
    draft.raw_profile_markdown && "notes",
  ].filter((part): part is string => Boolean(part));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The profile's Upwork link, and the fill that reads it. Pasting a profile
 * link fills at once. The extension opens the link in this browser, where the
 * user is signed in to Upwork, and the backend reads the pages into fields.
 */
export function ProfileLinkFill({
  value,
  onChange,
  onFilled,
}: {
  value: string;
  onChange: (value: string) => void;
  onFilled: (draft: FreelancerProfileDraft, link: string) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const link = profileLink(value);
  const busy = phase !== "idle";

  async function fill(target: string | null) {
    if (!target || busy) return;
    setPhase("reading");
    try {
      const outcome = await readUpworkProfile(target);
      if (outcome.kind === "absent") {
        toast("Fill from link needs the PhoeniX extension", {
          description: "It opens the profile in this browser, where you are signed in to Upwork.",
          action: { label: "Extension settings", onClick: () => router.push(EXTENSION_SETTINGS) },
        });
        return;
      }
      if (outcome.kind === "failed") {
        toast.error("The extension did not finish", { description: "Reload the extension, then fill again." });
        return;
      }
      if (!outcome.result.ok) {
        const why = NOT_READ[outcome.result.reason];
        toast.error(why.title, {
          description: why.description,
          action: why.openLink
            ? { label: "Open profile", onClick: () => window.open(target, "_blank", "noopener,noreferrer") }
            : undefined,
        });
        return;
      }

      setPhase("filling");
      const draft = await request<FreelancerProfileDraft>("/api/v1/freelancing/profiles/import", {
        method: "POST",
        body: JSON.stringify({ url: target, views: outcome.result.views }),
      });
      const filled = summary(draft);
      if (!filled) {
        toast("Nothing to fill", { description: "The profile page showed no details to copy." });
        return;
      }
      onFilled(draft, target);
      toast.success("Filled from Upwork", { description: `${filled}. Review, then save.` });
    } catch (error) {
      toast.error("Could not fill the profile", { description: (error as Error).message });
    } finally {
      setPhase("idle");
    }
  }

  return (
    <Panel className="flex flex-wrap items-center gap-2 p-2 sm:flex-nowrap" aria-busy={busy}>
      <label
        htmlFor="profile-upwork-link"
        className="text-muted-foreground flex shrink-0 items-center gap-1.5 pl-1 text-[13px] font-medium"
      >
        <Link2 className="size-4" />
        Upwork profile
      </label>
      <Input
        id="profile-upwork-link"
        inputMode="url"
        className="min-w-48 flex-1"
        value={value}
        disabled={busy}
        placeholder="https://www.upwork.com/freelancers/~01…"
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const pasted = profileLink(e.clipboardData.getData("text"));
          if (!pasted) return;
          e.preventDefault();
          onChange(pasted);
          void fill(pasted);
        }}
        onKeyDown={(e) => {
          // Enter fills from the link; it must not submit (save) the whole form.
          if (e.key !== "Enter") return;
          e.preventDefault();
          void fill(link);
        }}
      />
      <Button type="button" disabled={!link || busy} onClick={() => void fill(link)}>
        {busy ? <Spinner /> : <Wand2 />}
        {busy ? PHASE_LABEL[phase as Exclude<Phase, "idle">] : "Fill from link"}
      </Button>
    </Panel>
  );
}
