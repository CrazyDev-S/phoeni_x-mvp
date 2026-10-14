"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { TagInput } from "@/components/freelancing/tag-input";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";
import {
  invalidateFreelancing,
  PROPOSAL_STATUS_LABEL,
  timeAgo,
  type FreelancerProfile,
  type PortfolioItem,
  type Proposal,
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
  const sectionCard = "gap-0 p-[30px]";
  const subBlock = "bg-soft flex flex-col gap-2.5 rounded-3xl p-4";
  const trashButton = "text-muted-foreground size-10 rounded-full hover:bg-card";

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className={sectionCard}>
          <CardTitle className="text-[1.625rem]">{profile ? profile.name : "New profile"}</CardTitle>
          <CardDescription className="mt-1.5 max-w-xl text-sm leading-normal">
            How you present on Upwork. Proposals are drafted from this, so write it the way a client
            would read it.
          </CardDescription>

          <div className="mt-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_300px]">
              <FormField label="Profile name" hint="For your own reference, e.g. “Backend” or “Data”.">
                {(control) => <Input {...control} value={draft.name} onChange={(e) => set("name", e.target.value)} />}
              </FormField>
              <Field orientation="horizontal" className="bg-soft items-center gap-4 rounded-[20px] px-4 py-3 sm:self-start">
                <FieldLabel htmlFor="profile-default">
                  <div className="space-y-0.5">
                    <FieldTitle className="font-bold">Default</FieldTitle>
                    <FieldDescription className="text-xs">Used when a draft names none</FieldDescription>
                  </div>
                </FieldLabel>
                <Switch id="profile-default" checked={draft.is_default} onCheckedChange={(v) => set("is_default", v)} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
              <FormField label="Title" hint="The headline on your Upwork profile.">
                {(control) => (
                  <Input {...control} value={draft.title} placeholder="Senior Python & FastAPI engineer" onChange={(e) => set("title", e.target.value)} />
                )}
              </FormField>
              <FormField label="Hourly rate (USD)">
                {(control) => (
                  <div className="relative">
                    <span aria-hidden className="text-muted-foreground absolute top-1/2 left-4 -translate-y-1/2 text-[0.9375rem] font-semibold">$</span>
                    <Input {...control} type="number" min={0} step="1" className="pl-9" value={draft.hourly_rate} onChange={(e) => set("hourly_rate", e.target.value)} />
                  </div>
                )}
              </FormField>
            </div>

            <FormField label="Overview" hint="Your profile summary. The first sentence carries the most weight.">
              {(control) => (
                <Textarea {...control} rows={8} className="min-h-48 resize-none leading-relaxed" value={draft.overview} onChange={(e) => set("overview", e.target.value)} />
              )}
            </FormField>

            <FormField label="Skills" hint="Enter or comma to add. Matched against each posting's skills.">
              {(control) => <TagInput {...control} chips="pill" value={draft.skills} onChange={(v) => set("skills", v)} placeholder="Python, FastAPI, PostgreSQL" />}
            </FormField>

            <FormField label="Upwork profile URL">
              {(control) => (
                <div className="relative">
                  <Link2 aria-hidden className="text-muted-foreground absolute top-1/2 left-4 size-[17px] -translate-y-1/2" />
                  <Input {...control} inputMode="url" className="pl-11" value={draft.upwork_profile_url} placeholder="https://www.upwork.com/freelancers/~01…" onChange={(e) => set("upwork_profile_url", e.target.value)} />
                </div>
              )}
            </FormField>
          </div>
        </Card>

        <aside className="space-y-5">
          <Card tone="dark" className="gap-0 rounded-[36px] p-6">
            <div className="mb-5 flex items-center gap-4">
              <span aria-hidden className="bg-brand text-brand-foreground grid size-[72px] shrink-0 place-items-center rounded-full text-3xl font-semibold uppercase">
                {(draft.name.trim() || "P")[0]}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-2xl font-semibold tracking-tight">{draft.name.trim() || "New profile"}</span>
                  {draft.is_default && <Badge variant="brand">Default</Badge>}
                </div>
                <p className="text-panel-muted mt-1 text-sm leading-snug">{draft.title.trim() || "No title yet"}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2.5">
              {[
                { value: draft.hourly_rate.trim() === "" ? "—" : `$${draft.hourly_rate}`, label: "per hour" },
                { value: draft.skills.length, label: "Skills" },
                { value: draft.portfolio.length, label: "Portfolio" },
                { value: draft.specialized_profiles.length, label: "Specialized" },
              ].map((stat) => (
                <div key={stat.label} className="bg-panel-raised rounded-[20px] px-4 py-3.5">
                  <dd className="text-2xl font-medium tracking-tight tabular-nums">{stat.value}</dd>
                  <dt className="text-panel-muted text-[0.8125rem] font-medium">{stat.label}</dt>
                </div>
              ))}
            </dl>
            <Button type="submit" variant="brand" size="lg" className="mt-5 w-full" disabled={invalid || save.isPending}>
              {save.isPending ? <Spinner /> : <Check />}
              {profile ? "Save profile" : "Create profile"}
            </Button>
            {profile && (
              <Button
                type="button"
                size="lg"
                className="bg-panel-raised hover:bg-panel-raised/80 mt-2.5 w-full text-[color-mix(in_oklab,var(--destructive)_70%,white)]"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                <Trash2 />
                Delete profile
              </Button>
            )}
          </Card>

          {profile && <DraftedFrom profileId={profile.id} />}
        </aside>
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <Card className={sectionCard}>
          <CardTitle className="text-2xl">Portfolio</CardTitle>
          <CardDescription className="mt-1.5 text-sm leading-normal">
            Evidence a proposal can point at. Title, link, one line on what it shows.
          </CardDescription>
          <div className="mt-5 space-y-3.5">
            {draft.portfolio.map((item, index) => (
              <div key={index} className={subBlock}>
                <div className="grid items-center gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px]">
                  <Input
                    aria-label="Portfolio title"
                    placeholder="Title"
                    className="bg-card"
                    value={item.title}
                    onChange={(e) => set("portfolio", draft.portfolio.map((p, i) => (i === index ? { ...p, title: e.target.value } : p)))}
                  />
                  <Input
                    aria-label="Portfolio link"
                    placeholder="https://…"
                    className="bg-card"
                    value={item.url ?? ""}
                    onChange={(e) => set("portfolio", draft.portfolio.map((p, i) => (i === index ? { ...p, url: e.target.value || null } : p)))}
                  />
                  <Button type="button" size="icon" variant="ghost" className={trashButton} aria-label="Remove portfolio item" onClick={() => set("portfolio", draft.portfolio.filter((_, i) => i !== index))}>
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  aria-label="Portfolio summary"
                  rows={2}
                  placeholder="What it shows, in one or two sentences"
                  className="bg-card min-h-0 resize-none"
                  value={item.summary ?? ""}
                  onChange={(e) => set("portfolio", draft.portfolio.map((p, i) => (i === index ? { ...p, summary: e.target.value || null } : p)))}
                />
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => set("portfolio", [...draft.portfolio, { title: "", url: null, summary: null }])}>
              <Plus />
              Add an item
            </Button>
          </div>
        </Card>

        <Card className={sectionCard}>
          <CardTitle className="text-2xl">Specialized profiles</CardTitle>
          <CardDescription className="mt-1.5 text-sm leading-normal">
            Upwork lets you present differently per specialism. Keep each one&apos;s title and overview here.
          </CardDescription>
          <div className="mt-5 space-y-3.5">
            {draft.specialized_profiles.map((item, index) => (
              <div key={index} className={subBlock}>
                <div className="grid items-center gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px]">
                  <Input
                    aria-label="Specialized profile name"
                    placeholder="Name, e.g. Data engineering"
                    className="bg-card"
                    value={item.name}
                    onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))}
                  />
                  <Input
                    aria-label="Specialized profile title"
                    placeholder="Title"
                    className="bg-card"
                    value={item.title ?? ""}
                    onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, title: e.target.value || null } : p)))}
                  />
                  <Button type="button" size="icon" variant="ghost" className={trashButton} aria-label="Remove specialized profile" onClick={() => set("specialized_profiles", draft.specialized_profiles.filter((_, i) => i !== index))}>
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  aria-label="Specialized profile overview"
                  rows={3}
                  placeholder="Overview"
                  className="bg-card min-h-24 resize-none"
                  value={item.overview ?? ""}
                  onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, overview: e.target.value || null } : p)))}
                />
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => set("specialized_profiles", [...draft.specialized_profiles, { name: "", title: null, overview: null }])}>
              <Plus />
              Add a specialized profile
            </Button>
          </div>
        </Card>
      </div>

      <Card className={sectionCard}>
        <CardTitle className="text-2xl">Anything else</CardTitle>
        <CardDescription className="mt-1.5 text-sm leading-normal">
          Free-form notes in your own words: results, clients, how you work. The proposal engine reads this too.
        </CardDescription>
        <Textarea rows={8} className="mt-5 min-h-48 resize-none font-mono text-[13px] leading-relaxed" value={draft.raw_profile_markdown} onChange={(e) => set("raw_profile_markdown", e.target.value)} aria-label="Free-form profile notes" />
      </Card>

      {(save.error || remove.error) && <ErrorAlert>{((save.error ?? remove.error) as Error).message}</ErrorAlert>}
    </form>
  );
}

/** The proposals written from this profile, read from the same list the Proposals page uses. */
function DraftedFrom({ profileId }: { profileId: string }) {
  const { data } = useQuery({
    queryKey: ["freelancing", "proposals", "all"],
    queryFn: () =>
      request<{ items: Proposal[]; total: number }>("/api/v1/freelancing/proposals?limit=300"),
  });
  const rows = (data?.items ?? [])
    .filter((p) => p.profile_id === profileId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (!rows.length) return null;

  return (
    <Card className="gap-0 p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-medium tracking-tight">Drafted from this profile</h3>
        <span className="text-muted-foreground border-foreground border-b-[1.5px] pb-px text-[13px] font-semibold">
          {rows.length}
        </span>
      </div>
      <ul className="mt-1 divide-y">
        {rows.slice(0, 5).map((p) => {
          const status = PROPOSAL_STATUS_LABEL[p.status];
          return (
            <li key={p.id}>
              <Link
                href={`/freelancing/proposals/${p.id}`}
                className="focus-visible:ring-ring/40 flex items-center gap-3 rounded-xl py-3.5 outline-none focus-visible:ring-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.job?.title ?? "Untitled posting"}</div>
                  <div className="text-muted-foreground text-xs">{timeAgo(p.updated_at)}</div>
                </div>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
