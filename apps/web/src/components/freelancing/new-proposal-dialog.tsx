"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";
import {
  invalidateFreelancing,
  type FreelancerProfile,
  type JobCard,
} from "@/lib/freelancing";
import { cn } from "@/lib/utils";

const TONES = [
  ["direct", "Direct"],
  ["warm", "Warm"],
  ["formal", "Formal"],
] as const;

/**
 * Start a draft: pick a focused posting and a profile, say how it should sound.
 *
 * The engine runs in the background; the dialog hands off to the proposal
 * page, which follows the run and shows the draft when it lands.
 */
export function NewProposalDialog({
  open,
  jobId,
  onClose,
}: {
  open: boolean;
  /** Preselected, when opened from a posting. */
  jobId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [job, setJob] = useState(jobId ?? "");
  const [profile, setProfile] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number][0]>("direct");
  const [instructions, setInstructions] = useState("");

  const focused = useQuery({
    queryKey: ["freelancing", "jobs", "focused"],
    queryFn: () => request<{ items: JobCard[] }>("/api/v1/freelancing/jobs?focused=true&limit=200"),
    enabled: open,
  });
  const profiles = useQuery({
    queryKey: ["freelancing", "profiles"],
    queryFn: () => request<FreelancerProfile[]>("/api/v1/freelancing/profiles"),
    enabled: open,
  });

  const jobs = focused.data?.items ?? [];
  const chosenJob = job || jobId || "";
  const defaultProfile = profiles.data?.find((p) => p.is_default) ?? profiles.data?.[0];
  const chosenProfile = profile || defaultProfile?.id || "";

  const generate = useMutation({
    mutationFn: () =>
      request<{ id: string; proposal_id: string }>("/api/v1/freelancing/proposals/generate", {
        method: "POST",
        body: JSON.stringify({
          job_id: chosenJob,
          profile_id: chosenProfile || null,
          tone,
          instructions: instructions.trim() || null,
        }),
      }),
    onSuccess: ({ id, proposal_id }) => {
      invalidateFreelancing(queryClient);
      onClose();
      router.push(`/freelancing/proposals/${proposal_id}?generation=${id}`);
    },
  });

  const labelClass = "text-panel-foreground text-[13px] font-bold";
  const controlClass =
    "bg-panel-raised text-panel-foreground placeholder:text-panel-muted focus-visible:bg-panel-raised focus-visible:border-white/40 data-[state=open]:bg-panel-raised data-[state=open]:border-white/40";
  // Offer the posting list whenever the preselected posting is in it; a posting
  // opened from elsewhere (not focused) stays implied.
  const showPostings = !jobId || jobs.some((j) => j.id === jobId);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="bg-panel text-panel-foreground rounded-[2.25rem] ring-0 sm:max-w-md [&_[data-slot=field-description]]:text-panel-muted [&_[data-slot=field-label]]:text-panel-foreground [&_[data-slot=field-label]]:text-[13px] [&_[data-slot=field-label]]:font-bold"
      >
        <DialogHeader className="gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className="text-2xl leading-tight font-medium tracking-tight">
              Draft a proposal
            </DialogTitle>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                className="bg-panel-raised hover:bg-panel-raised/70 focus-visible:ring-ring/40 grid size-9 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </div>
          <DialogDescription className="text-panel-muted leading-snug">
            A first draft from your profile and the posting. Every line is meant to be rewritten.
          </DialogDescription>
        </DialogHeader>

        {focused.isSuccess && !jobs.length && !jobId ? (
          <p className="text-panel-muted text-sm">
            Focus a posting first.{" "}
            <Link href="/freelancing/jobs" className="text-brand hover:underline">
              Search jobs
            </Link>
            .
          </p>
        ) : (
          <FieldGroup className="gap-4">
            {showPostings && (
              <FormField label="Posting">
                {(control) => (
                  <Select value={chosenJob} onValueChange={setJob}>
                    <SelectTrigger {...control} className={cn("w-full", controlClass)}>
                      <SelectValue placeholder="Pick a focused posting" />
                    </SelectTrigger>
                    <SelectContent>
                      {jobs.map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
            <FormField label="Profile" hint={profiles.isSuccess && !profiles.data.length ? "No profile yet; the draft will be thinner." : undefined}>
              {(control) => (
                <Select value={chosenProfile} onValueChange={setProfile} disabled={!profiles.data?.length}>
                  <SelectTrigger {...control} className={cn("w-full", controlClass)}>
                    <SelectValue placeholder="No profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {(profiles.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.is_default ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <div className="flex flex-col gap-2">
              <span id="proposal-tone" className={labelClass}>
                Tone
              </span>
              <div
                role="radiogroup"
                aria-labelledby="proposal-tone"
                className="bg-panel-raised flex gap-0.5 rounded-full p-1"
              >
                {TONES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={tone === value}
                    onClick={() => setTone(value)}
                    className={cn(
                      "focus-visible:ring-ring/40 h-10 flex-1 rounded-full text-sm font-semibold transition-colors outline-none focus-visible:ring-3",
                      tone === value
                        ? "bg-brand text-brand-foreground"
                        : "text-panel-muted hover:text-panel-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <FormField label="Instructions" hint="Anything this draft should lead with or leave out.">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Lead with the payments migration; keep it under 150 words."
                  className={cn("min-h-24", controlClass)}
                />
              )}
            </FormField>
          </FieldGroup>
        )}

        {generate.error && (
          <div className="mt-4">
            <ErrorAlert>{(generate.error as Error).message}</ErrorAlert>
          </div>
        )}

        <DialogFooter className="mx-0 mt-6 mb-0 flex-row gap-2.5 border-0 bg-transparent p-0">
          <Button
            variant="outline"
            size="lg"
            onClick={onClose}
            className="border-panel-muted/40 text-panel-foreground hover:bg-white/8"
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            size="lg"
            className="flex-1"
            disabled={!chosenJob || generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? <Spinner /> : <Sparkles />}
            Draft it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
