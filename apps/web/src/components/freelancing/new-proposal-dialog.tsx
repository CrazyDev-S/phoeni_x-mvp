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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Draft a proposal</DialogTitle>
          <DialogDescription>
            A first draft from your profile and the posting. Every line is meant to be rewritten.
          </DialogDescription>
        </DialogHeader>

        {focused.isSuccess && !jobs.length && !jobId ? (
          <p className="text-muted-foreground text-sm">
            Focus a posting first.{" "}
            <Link href="/freelancing/jobs" className="text-primary hover:underline">
              Search jobs
            </Link>
            .
          </p>
        ) : (
          <FieldGroup className="gap-4">
            {!jobId && (
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
            <div className="grid gap-4 sm:grid-cols-2">
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
              <FormField label="Tone">
                {(control) => (
                  <Select value={tone} onValueChange={(v) => setTone(v as typeof tone)}>
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
            <FormField label="Instructions" hint="Anything this draft should lead with or leave out.">
              {(control) => (
                <Textarea {...control} rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Lead with the payments migration; keep it under 150 words." />
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
