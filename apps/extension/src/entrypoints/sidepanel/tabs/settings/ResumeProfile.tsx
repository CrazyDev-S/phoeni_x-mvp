import { Check, Save, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { ResumeProfile } from "@/lib/types";
import { Section } from "../../chrome-shell";
import { ErrorNote, PanelField } from "../../components";

/** The form's text, with list fields as one entry per line. */
interface Draft {
  full_name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: string;
  education: string;
  summary: string;
}

function toDraft(profile: ResumeProfile): Draft {
  return {
    full_name: profile.full_name ?? "",
    headline: profile.headline ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    location: profile.location ?? "",
    links: profile.links.join("\n"),
    education: profile.education.join("\n"),
    summary: profile.summary ?? "",
  };
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Who "New generate" writes each resume for.
 *
 * Without it the generator has no candidate, and invents a name and contacts.
 */
export function ResumeProfileSection() {
  const [saved, setSaved] = useState<ResumeProfile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    api<ResumeProfile>("/api/v1/settings/resume-profile")
      .then((profile) => {
        setSaved(profile);
        setDraft(toDraft(profile));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  if (loadError) {
    return (
      <Section title="Resume profile">
        <p className="text-muted-foreground rounded-xl border border-dashed px-3 py-4 text-center text-[11px]">
          Connect above to edit your resume profile.
        </p>
      </Section>
    );
  }

  if (!draft || !saved) {
    return (
      <Section title="Resume profile">
        <Skeleton className="h-64 w-full rounded-xl" />
      </Section>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
  const set = (field: keyof Draft) => (value: string) => {
    setJustSaved(false);
    setDraft((d) => (d ? { ...d, [field]: value } : d));
  };

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await api<ResumeProfile>("/api/v1/settings/resume-profile", {
        method: "PUT",
        body: JSON.stringify({
          full_name: draft.full_name,
          headline: draft.headline,
          email: draft.email,
          phone: draft.phone,
          location: draft.location,
          links: lines(draft.links).slice(0, 10),
          education: lines(draft.education).slice(0, 10),
          summary: draft.summary,
        }),
      });
      setSaved(profile);
      setDraft(toDraft(profile));
      setJustSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Resume profile">
      <Card className="py-3">
        <CardContent className="px-3">
          <FieldGroup className="gap-3">
            <div className="flex items-start gap-2.5">
              <span className="bg-accent text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
                <UserRound className="size-3.5" />
              </span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Who <strong className="text-foreground font-medium">New generate</strong> writes
                each resume for. Without it, every resume gets an invented name and contacts.
              </p>
            </div>

            <PanelField label="Full name">
              {(control) => (
                <Input
                  {...control}
                  autoComplete="name"
                  value={draft.full_name}
                  onChange={(e) => set("full_name")(e.target.value)}
                />
              )}
            </PanelField>

            <PanelField label="Headline">
              {(control) => (
                <Input
                  {...control}
                  placeholder="Senior Backend Engineer"
                  value={draft.headline}
                  onChange={(e) => set("headline")(e.target.value)}
                />
              )}
            </PanelField>

            <PanelField label="Email">
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  autoComplete="email"
                  value={draft.email}
                  onChange={(e) => set("email")(e.target.value)}
                />
              )}
            </PanelField>

            <div className="grid grid-cols-2 gap-2">
              <PanelField label="Phone">
                {(control) => (
                  <Input
                    {...control}
                    type="tel"
                    autoComplete="tel"
                    value={draft.phone}
                    onChange={(e) => set("phone")(e.target.value)}
                  />
                )}
              </PanelField>
              <PanelField label="Location">
                {(control) => (
                  <Input
                    {...control}
                    placeholder="City, Country"
                    value={draft.location}
                    onChange={(e) => set("location")(e.target.value)}
                  />
                )}
              </PanelField>
            </div>

            <PanelField label="Links" hint="One per line: LinkedIn, GitHub, portfolio.">
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  value={draft.links}
                  onChange={(e) => set("links")(e.target.value)}
                />
              )}
            </PanelField>

            <PanelField label="Education" hint="One per line: degree, school, year.">
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  value={draft.education}
                  onChange={(e) => set("education")(e.target.value)}
                />
              )}
            </PanelField>

            <PanelField
              label="Work history"
              hint="Employers, titles, dates and stack. Filled in, every resume keeps them as given. Left empty, each resume builds its career from the job."
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={5}
                  value={draft.summary}
                  onChange={(e) => set("summary")(e.target.value)}
                />
              )}
            </PanelField>

            <Button className="h-10 w-full" disabled={!dirty || busy} onClick={save}>
              {busy ? <Spinner /> : <Save />}
              Save profile
            </Button>

            {justSaved && !dirty && (
              <p className="text-success flex items-center gap-1.5 text-xs">
                <Check className="size-3.5 shrink-0" />
                {saved.configured
                  ? saved.mode === "grounded"
                    ? "Saved. New resumes keep your work history."
                    : "Saved. New resumes build their career from each job."
                  : "Cleared. New resumes get an invented name again."}
              </p>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
          </FieldGroup>
        </CardContent>
      </Card>
    </Section>
  );
}
