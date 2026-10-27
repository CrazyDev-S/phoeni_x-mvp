"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { ProfileForm } from "@/components/freelancing/profile-form";
import { PageHero } from "@/components/page-hero";
import { Chip, ChipCount, ChipRow } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { request } from "@/lib/api";
import type { FreelancerProfile } from "@/lib/freelancing";

const NEW = "new";

export default function ProfilePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["freelancing", "profiles"],
    queryFn: () => request<FreelancerProfile[]>("/api/v1/freelancing/profiles"),
  });
  // An id, NEW, or null for "whichever is the default".
  const [selected, setSelected] = useState<string | null>(null);

  const profiles = data ?? [];
  const active =
    selected === NEW
      ? null
      : (profiles.find((p) => p.id === selected) ??
        profiles.find((p) => p.is_default) ??
        profiles[0] ??
        null);

  return (
    <div className="space-y-3">
      <PageHero
        title="Profile"
        stats={
          profiles.length > 0
            ? [
                { value: profiles.length, label: profiles.length === 1 ? "Profile" : "Profiles" },
                { value: active?.skills.length ?? 0, label: "Skills" },
                { value: active?.portfolio.length ?? 0, label: "Portfolio items" },
              ]
            : undefined
        }
      />

      {error && <ErrorAlert>{(error as Error).message}</ErrorAlert>}

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-3">
          {profiles.length > 0 && (
            <ChipRow>
              {profiles.map((p) => (
                <Chip key={p.id} active={active?.id === p.id} onClick={() => setSelected(p.id)}>
                  {p.name}
                  {p.is_default && <ChipCount>Default</ChipCount>}
                </Chip>
              ))}
              <Chip active={selected === NEW} className="border-dashed" onClick={() => setSelected(NEW)}>
                <Plus />
                New profile
              </Chip>
            </ChipRow>
          )}

          <ProfileForm
            key={active?.id ?? NEW}
            profile={active}
            onSaved={(saved) => setSelected(saved.id)}
            onDeleted={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
}
