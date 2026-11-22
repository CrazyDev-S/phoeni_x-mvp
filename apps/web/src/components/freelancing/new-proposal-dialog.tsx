"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

/**
 * Start a draft: pick a focused posting and a profile, and optionally say what to lead with.
 *
 * The writer runs in the background; the dialog hands off to the proposal
 * page, whose writer panel follows the run and shows draft 1.1 when it lands.
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
  const [instruction, setInstruction] = useState("");

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
          instruction: instruction.trim() || null,
        }),
      }),
    onSuccess: ({ proposal_id }) => {
      invalidateFreelancing(queryClient);
      onClose();
      router.push(`/freelancing/proposals/${proposal_id}`);
    },
  });

  // Offer the posting list whenever the preselected posting is in it; a posting
  // opened from elsewhere (not focused) stays implied.
  const showPostings = !jobId || jobs.some((j) => j.id === jobId);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Draft a proposal</DialogTitle>
        </DialogHeader>

        {focused.isSuccess && !jobs.length && !jobId ? (
          <p className="text-muted-foreground text-[13px]">
            Focus a posting first.{" "}
            <Link href="/freelancing/jobs" className="text-foreground underline underline-offset-2">
              Search jobs
            </Link>
            .
          </p>
        ) : (
          <FieldGroup className="gap-3">
            {showPostings && (
              <FormField label="Posting">
                {(control) => (
                  <Select value={chosenJob} onValueChange={setJob}>
                    <SelectTrigger {...control} className="w-full">
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
                  <SelectTrigger {...control} className="w-full">
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
            <FormField label="Lead with" hint="Optional. A link here is read before writing.">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="The Stripe Connect payouts I built for a marketplace — https://…"
                  className="min-h-16"
                />
              )}
            </FormField>
          </FieldGroup>
        )}

        {generate.error && <ErrorAlert>{(generate.error as Error).message}</ErrorAlert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!chosenJob || generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? <Spinner /> : <Sparkles />}
            Draft it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
