"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { TagInput } from "@/components/freelancing/tag-input";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";
import {
  invalidateFreelancing,
  type FreelancerProfile,
  type PortfolioItem,
  type SpecializedProfile,
} from "@/lib/freelancing";

interface Draft {
  name: string;
  is_default: boolean;
  title: string;
  overview: string;
  hourly_rate: string;
  skills: string[];
  portfolio: PortfolioItem[];
  specialized_profiles: SpecializedProfile[];
  upwork_profile_url: string;
  raw_profile_markdown: string;
}

function toDraft(profile: FreelancerProfile | null): Draft {
  return {
    name: profile?.name ?? "",
    is_default: profile?.is_default ?? false,
    title: profile?.title ?? "",
    overview: profile?.overview ?? "",
    hourly_rate: profile?.hourly_rate == null ? "" : String(profile.hourly_rate),
    skills: profile?.skills ?? [],
    portfolio: profile?.portfolio ?? [],
    specialized_profiles: profile?.specialized_profiles ?? [],
    upwork_profile_url: profile?.upwork_profile_url ?? "",
    raw_profile_markdown: profile?.raw_profile_markdown ?? "",
  };
}

/**
 * The freelancer profile editor.
 *
 * What a proposal is written from: title, overview, rate, skills, and the
 * evidence. The free-form markdown at the end is for anything the fields do
 * not hold; the engine reads it too.
 */
export function ProfileForm({
  profile,
  onSaved,
  onDeleted,
}: {
  profile: FreelancerProfile | null;
  onSaved: (saved: FreelancerProfile) => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name.trim(),
        is_default: draft.is_default,
        title: draft.title.trim() || null,
        overview: draft.overview.trim() || null,
        hourly_rate: draft.hourly_rate.trim() === "" ? null : Number(draft.hourly_rate),
        skills: draft.skills,
        portfolio: draft.portfolio.filter((p) => p.title.trim()),
        specialized_profiles: draft.specialized_profiles.filter((p) => p.name.trim()),
        upwork_profile_url: draft.upwork_profile_url.trim() || null,
        raw_profile_markdown: draft.raw_profile_markdown.trim() || null,
      };
      return profile
        ? request<FreelancerProfile>(`/api/v1/freelancing/profiles/${profile.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : request<FreelancerProfile>("/api/v1/freelancing/profiles", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: (saved) => {
      invalidateFreelancing(queryClient);
      toast.success(profile ? "Profile saved" : "Profile created");
      onSaved(saved);
    },
  });

  const remove = useMutation({
    mutationFn: () => request(`/api/v1/freelancing/profiles/${profile!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateFreelancing(queryClient);
      toast.success("Profile deleted");
      onDeleted?.();
    },
  });

  const invalid = !draft.name.trim();

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{profile ? profile.name : "New profile"}</CardTitle>
          <CardDescription>
            How you present on Upwork. Proposals are drafted from this, so write it the way a
            client would read it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <FormField label="Profile name" hint="For your own reference, e.g. “Backend” or “Data”.">
              {(control) => <Input {...control} value={draft.name} onChange={(e) => set("name", e.target.value)} />}
            </FormField>
            <Field orientation="horizontal" className="sm:pt-6">
              <FieldLabel htmlFor="profile-default">
                <div className="space-y-0.5">
                  <FieldTitle>Default</FieldTitle>
                  <FieldDescription>Used when a draft does not name one.</FieldDescription>
                </div>
              </FieldLabel>
              <Switch id="profile-default" checked={draft.is_default} onCheckedChange={(v) => set("is_default", v)} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <FormField label="Title" hint="The headline on your Upwork profile.">
              {(control) => (
                <Input {...control} value={draft.title} placeholder="Senior Python & FastAPI engineer" onChange={(e) => set("title", e.target.value)} />
              )}
            </FormField>
            <FormField label="Hourly rate (USD)">
              {(control) => (
                <Input {...control} type="number" min={0} step="1" value={draft.hourly_rate} onChange={(e) => set("hourly_rate", e.target.value)} />
              )}
            </FormField>
          </div>

          <FormField label="Overview" hint="Your profile summary. The first sentence carries the most weight.">
            {(control) => (
              <Textarea {...control} rows={6} value={draft.overview} onChange={(e) => set("overview", e.target.value)} />
            )}
          </FormField>

          <FormField label="Skills" hint="Enter or comma to add. Matched against each posting's skills.">
            {(control) => <TagInput {...control} value={draft.skills} onChange={(v) => set("skills", v)} placeholder="Python, FastAPI, PostgreSQL" />}
          </FormField>

          <FormField label="Upwork profile URL">
            {(control) => (
              <Input {...control} inputMode="url" value={draft.upwork_profile_url} placeholder="https://www.upwork.com/freelancers/~01…" onChange={(e) => set("upwork_profile_url", e.target.value)} />
            )}
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio</CardTitle>
          <CardDescription>Evidence a proposal can point at. Title, link, one line on what it shows.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.portfolio.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input
                aria-label="Portfolio title"
                placeholder="Title"
                value={item.title}
                onChange={(e) => set("portfolio", draft.portfolio.map((p, i) => (i === index ? { ...p, title: e.target.value } : p)))}
              />
              <Input
                aria-label="Portfolio link"
                placeholder="https://…"
                value={item.url ?? ""}
                onChange={(e) => set("portfolio", draft.portfolio.map((p, i) => (i === index ? { ...p, url: e.target.value || null } : p)))}
              />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove portfolio item" onClick={() => set("portfolio", draft.portfolio.filter((_, i) => i !== index))}>
                <Trash2 />
              </Button>
              <Textarea
                aria-label="Portfolio summary"
                rows={2}
                placeholder="What it shows, in one or two sentences"
                className="sm:col-span-3"
                value={item.summary ?? ""}
                onChange={(e) => set("portfolio", draft.portfolio.map((p, i) => (i === index ? { ...p, summary: e.target.value || null } : p)))}
              />
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => set("portfolio", [...draft.portfolio, { title: "", url: null, summary: null }])}>
            <Plus />
            Add an item
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specialized profiles</CardTitle>
          <CardDescription>Upwork lets you present differently per specialism. Keep each one's title and overview here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.specialized_profiles.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input
                aria-label="Specialized profile name"
                placeholder="Name, e.g. Data engineering"
                value={item.name}
                onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))}
              />
              <Input
                aria-label="Specialized profile title"
                placeholder="Title"
                value={item.title ?? ""}
                onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, title: e.target.value || null } : p)))}
              />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove specialized profile" onClick={() => set("specialized_profiles", draft.specialized_profiles.filter((_, i) => i !== index))}>
                <Trash2 />
              </Button>
              <Textarea
                aria-label="Specialized profile overview"
                rows={3}
                placeholder="Overview"
                className="sm:col-span-3"
                value={item.overview ?? ""}
                onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, overview: e.target.value || null } : p)))}
              />
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => set("specialized_profiles", [...draft.specialized_profiles, { name: "", title: null, overview: null }])}>
            <Plus />
            Add a specialized profile
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anything else</CardTitle>
          <CardDescription>
            Free-form notes in your own words: results, clients, how you work. The proposal engine reads this too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea rows={8} className="font-mono text-xs" value={draft.raw_profile_markdown} onChange={(e) => set("raw_profile_markdown", e.target.value)} aria-label="Free-form profile notes" />
        </CardContent>
      </Card>

      {(save.error || remove.error) && <ErrorAlert>{((save.error ?? remove.error) as Error).message}</ErrorAlert>}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="brand" disabled={invalid || save.isPending}>
          {save.isPending && <Spinner />}
          {profile ? "Save profile" : "Create profile"}
        </Button>
        {profile && (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive ml-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2 />
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}
