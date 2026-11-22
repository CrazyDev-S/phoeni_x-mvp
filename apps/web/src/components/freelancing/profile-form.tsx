"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ProfileLinkFill, type FreelancerProfileDraft } from "@/components/freelancing/profile-link-fill";
import { ProfileWriter, type ProfileMaterial } from "@/components/freelancing/profile-writer";
import { ProfileWriting } from "@/components/freelancing/profile-writing";
import { TagInput } from "@/components/freelancing/tag-input";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Panel, PanelHead } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { hasWriting, isSaved, versionLabel, type ProfileVersion } from "@/lib/profile-writer";
import { cn } from "@/lib/utils";

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
 * What a fill from the profile's Upwork link writes: every field the link had
 * an answer for. The name is the user's, so it is only filled when blank.
 * Nothing is saved until Save.
 */
function fromLink(read: FreelancerProfileDraft): Partial<Draft> {
  const found: Partial<Draft> = {
    title: read.title ?? undefined,
    overview: read.overview ?? undefined,
    hourly_rate: read.hourly_rate == null ? undefined : String(read.hourly_rate),
    skills: read.skills.length ? read.skills : undefined,
    portfolio: read.portfolio.length ? read.portfolio : undefined,
    specialized_profiles: read.specialized_profiles.length ? read.specialized_profiles : undefined,
    raw_profile_markdown: read.raw_profile_markdown ?? undefined,
  };
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value !== undefined));
}

/** The written profile as the form holds it: what is saved, and what the writer works from. */
function material(draft: Draft): ProfileMaterial {
  return {
    title: draft.title.trim() || null,
    overview: draft.overview.trim() || null,
    hourly_rate: draft.hourly_rate.trim() === "" ? null : Number(draft.hourly_rate),
    skills: draft.skills,
    portfolio: draft.portfolio.filter((p) => p.title.trim()),
    specialized_profiles: draft.specialized_profiles.filter((p) => p.name.trim()),
    raw_profile_markdown: draft.raw_profile_markdown.trim() || null,
  };
}

/** What a writer version puts in the form: its fields that have an answer. */
function fromVersion(version: ProfileVersion): Partial<Draft> {
  const doc = version.document;
  const found: Partial<Draft> = {};
  if (doc.title) found.title = doc.title;
  if (doc.summary) found.overview = doc.summary;
  if (doc.skills?.length) found.skills = doc.skills;
  if (doc.hourly_rate != null) found.hourly_rate = String(doc.hourly_rate);
  return found;
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
  // The fields the last fill from the link wrote, lit briefly so the change is seen.
  const [filled, setFilled] = useState<(keyof Draft)[]>([]);
  const glow = (key: keyof Draft) => (filled.includes(key) ? "fill-glow" : undefined);
  useEffect(() => {
    if (!filled.length) return;
    const timer = setTimeout(() => setFilled([]), 1600);
    return () => clearTimeout(timer);
  }, [filled]);

  // The writer version the form holds; Save turns it into the next whole version.
  const [version, setVersion] = useState<ProfileVersion | null>(null);
  function applyVersion(v: ProfileVersion) {
    const found = fromVersion(v);
    // A profile without a name is named after the title's lead keyword.
    const named = v.document.titles?.[0]?.keyword;
    if (named && !draft.name.trim()) found.name = named;
    setDraft((d) => ({ ...d, ...found }));
    setFilled(Object.keys(found) as (keyof Draft)[]);
    setVersion(v);
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...material(draft),
        name: draft.name.trim(),
        is_default: draft.is_default,
        upwork_profile_url: draft.upwork_profile_url.trim() || null,
        version_id: version?.id ?? null,
      };
      return profile
        ? request<FreelancerProfile>(`/api/v1/freelancing/profiles/${profile.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : request<FreelancerProfile>("/api/v1/freelancing/profiles", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: (saved) => {
      invalidateFreelancing(queryClient);
      const bumped = saved.version != null && saved.version !== profile?.version;
      toast.success(bumped ? `Saved as version ${saved.version}` : profile ? "Profile saved" : "Profile created");
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
  const subBlock = "bg-muted/50 flex flex-col gap-1.5 rounded-md p-2";

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold">{profile ? profile.name : "New profile"}</h2>
        {version && !isSaved(version) ? (
          <StatusBadge tone="warn">Draft {versionLabel(version)} · not saved</StatusBadge>
        ) : (
          profile?.version != null && <StatusBadge tone="neutral">Version {profile.version}</StatusBadge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {profile && (
            <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 />
              Delete
            </Button>
          )}
          <Button type="submit" variant="brand" disabled={invalid || save.isPending}>
            {save.isPending ? <Spinner /> : <Check />}
            {profile ? "Save profile" : "Create profile"}
          </Button>
        </div>
      </div>

      {(save.error || remove.error) && <ErrorAlert>{((save.error ?? remove.error) as Error).message}</ErrorAlert>}

      <ProfileLinkFill
        value={draft.upwork_profile_url}
        onChange={(v) => set("upwork_profile_url", v)}
        onFilled={(read, link) => {
          const found = fromLink(read);
          const keys = Object.keys(found) as (keyof Draft)[];
          if (read.name && !draft.name.trim()) keys.push("name");
          // The read takes a while; merge into the form as it is now, not as it was.
          setDraft((d) => ({ ...d, ...found, upwork_profile_url: link, name: d.name.trim() ? d.name : (read.name ?? "") }));
          setFilled(keys);
        }}
      />

      <ProfileWriter
        profileId={profile?.id ?? null}
        active={version}
        material={() => material(draft)}
        onApply={applyVersion}
        onSettle={setVersion}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <Panel className="space-y-2.5 p-3">
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <FormField label="Profile name">
                {(control) => <Input {...control} className={glow("name")} value={draft.name} onChange={(e) => set("name", e.target.value)} />}
              </FormField>
              <div className="flex items-end gap-2 pb-1.5">
                <Switch id="profile-default" size="sm" checked={draft.is_default} onCheckedChange={(v) => set("is_default", v)} />
                <Label htmlFor="profile-default">Default</Label>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <FormField label="Title">
                {(control) => (
                  <Input {...control} data-styled="float" className={glow("title")} value={draft.title} placeholder="Senior Python & FastAPI engineer" onChange={(e) => set("title", e.target.value)} />
                )}
              </FormField>
              <FormField label="Hourly rate (USD)">
                {(control) => (
                  <div className="relative">
                    <span aria-hidden className="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px]">$</span>
                    <Input {...control} type="number" min={0} step="any" className={cn("pl-6", glow("hourly_rate"))} value={draft.hourly_rate} onChange={(e) => set("hourly_rate", e.target.value)} />
                  </div>
                )}
              </FormField>
            </div>

            <FormField label="Overview">
              {(control) => (
                <Textarea {...control} rows={7} className={cn("min-h-32", glow("overview"))} value={draft.overview} onChange={(e) => set("overview", e.target.value)} />
              )}
            </FormField>

            <FormField label="Skills">
              {(control) => <TagInput {...control} chips="pill" className={glow("skills")} value={draft.skills} onChange={(v) => set("skills", v)} placeholder="Python, FastAPI, PostgreSQL" />}
            </FormField>

          </Panel>

          <Panel className="space-y-1.5 p-3">
            <h3 className="text-[13px] font-semibold">Notes</h3>
            <Textarea rows={6} className={cn("min-h-28 font-mono text-xs", glow("raw_profile_markdown"))} value={draft.raw_profile_markdown} onChange={(e) => set("raw_profile_markdown", e.target.value)} aria-label="Free-form profile notes" />
          </Panel>
        </div>

        <div className="min-w-0 space-y-3">
          {version && hasWriting(version.document) && (
            <ProfileWriting
              version={version}
              title={draft.title}
              onUseTitle={(t) => {
                set("title", t);
                setFilled(["title"]);
              }}
            />
          )}

          <Panel className={glow("portfolio")}>
            <PanelHead title="Portfolio" count={draft.portfolio.length}>
              <Button type="button" size="xs" variant="outline" onClick={() => set("portfolio", [...draft.portfolio, { title: "", url: null, summary: null }])}>
                <Plus />
                Add
              </Button>
            </PanelHead>
            {draft.portfolio.length > 0 && (
              <div className="space-y-1.5 p-2">
                {draft.portfolio.map((item, index) => (
                  <div key={index} className={subBlock}>
                    <div className="grid items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem]">
                      <Input
                        data-styled="float"
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
                      <Button type="button" size="icon" variant="ghost" className="text-muted-foreground" aria-label="Remove portfolio item" onClick={() => set("portfolio", draft.portfolio.filter((_, i) => i !== index))}>
                        <Trash2 />
                      </Button>
                    </div>
                    <Textarea
                      aria-label="Portfolio summary"
                      rows={2}
                      placeholder="What it shows"
                      className="min-h-0"
                      value={item.summary ?? ""}
                      onChange={(e) => set("portfolio", draft.portfolio.map((p, i) => (i === index ? { ...p, summary: e.target.value || null } : p)))}
                    />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel className={glow("specialized_profiles")}>
            <PanelHead title="Specialized profiles" count={draft.specialized_profiles.length}>
              <Button type="button" size="xs" variant="outline" onClick={() => set("specialized_profiles", [...draft.specialized_profiles, { name: "", title: null, overview: null }])}>
                <Plus />
                Add
              </Button>
            </PanelHead>
            {draft.specialized_profiles.length > 0 && (
              <div className="space-y-1.5 p-2">
                {draft.specialized_profiles.map((item, index) => (
                  <div key={index} className={subBlock}>
                    <div className="grid items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem]">
                      <Input
                        aria-label="Specialized profile name"
                        placeholder="Name, e.g. Data engineering"
                        value={item.name}
                        onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))}
                      />
                      <Input
                        data-styled="float"
                        aria-label="Specialized profile title"
                        placeholder="Title"
                        value={item.title ?? ""}
                        onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, title: e.target.value || null } : p)))}
                      />
                      <Button type="button" size="icon" variant="ghost" className="text-muted-foreground" aria-label="Remove specialized profile" onClick={() => set("specialized_profiles", draft.specialized_profiles.filter((_, i) => i !== index))}>
                        <Trash2 />
                      </Button>
                    </div>
                    <Textarea
                      aria-label="Specialized profile overview"
                      rows={3}
                      placeholder="Overview"
                      className="min-h-16"
                      value={item.overview ?? ""}
                      onChange={(e) => set("specialized_profiles", draft.specialized_profiles.map((p, i) => (i === index ? { ...p, overview: e.target.value || null } : p)))}
                    />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {profile && <DraftedFrom profileId={profile.id} />}
        </div>
      </div>
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
    <Panel>
      <PanelHead title="Drafted from this profile" count={rows.length} />
      <ul className="divide-y">
        {rows.slice(0, 8).map((p) => {
          const status = PROPOSAL_STATUS_LABEL[p.status];
          return (
            <li key={p.id}>
              <Link
                href={`/freelancing/proposals/${p.id}`}
                className="hover:bg-muted/50 focus-visible:ring-ring/40 flex items-center gap-2 px-3 py-1.5 outline-none focus-visible:ring-2"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{p.job?.title ?? "Untitled posting"}</span>
                <span className="text-muted-foreground text-xs">{timeAgo(p.updated_at)}</span>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
