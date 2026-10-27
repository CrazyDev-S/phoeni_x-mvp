"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Cpu,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Plug,
  PlugZap,
  Plus,
  Puzzle,
  Save,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  Wand2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { ApifyConnect } from "@/components/freelancing/apify-connect-card";
import { useJobSource } from "@/components/freelancing/job-source";
import { UpworkConnect } from "@/components/freelancing/upwork-connect-card";
import { AutofillProfile } from "@/components/remote/autofill-profile-card";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { PageHero } from "@/components/page-hero";
import {
  DownloadExtension,
  formatBytes,
  useExtensionPackage,
} from "@/components/portal/download-extension";
import {
  Row,
  Rule,
  SettingRow,
  SettingsSection,
  SubHead,
} from "@/components/settings/section";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { initialsOf, nameOf, useMe } from "@/hooks/use-me";
import { request, tokens as authTokens } from "@/lib/api";
import { PALETTES } from "@/lib/palettes";
import { usePalette } from "@/lib/use-palette";
import { cn } from "@/lib/utils";

interface Credential {
  provider: string;
  configured: boolean;
  masked_key: string;
  status: string;
  last_error: string | null;
}

interface Settings {
  default_provider: string;
  heavy_model: string;
  mid_model: string;
  fast_model: string;
  base_country: string;
  research_dossiers: boolean;
  strict_dossier: boolean;
  allow_real_company_names: boolean;
  display_timezone: string;
  credentials: Credential[];
}

interface ModelRow {
  provider: string;
  model_id: string;
  display_name: string;
  tier: string;
}

const CREDENTIAL_TONE: Record<string, Tone> = { valid: "ok", invalid: "bad" };

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

const GENERATION_TOGGLES = [
  ["research_dossiers", "Research company dossiers"],
  ["strict_dossier", "Block employers with no sourced dossier"],
  ["allow_real_company_names", "Name real companies"],
] as const;

const SECTIONS = [
  { id: "profile", label: "Profile", Icon: UserRound },
  { id: "models", label: "Models", Icon: Cpu },
  { id: "integrations", label: "Integrations", Icon: Plug },
  { id: "generation", label: "Generation", Icon: Sparkles },
  { id: "autofill", label: "Autofill", Icon: Wand2 },
  { id: "extension", label: "Extension", Icon: Puzzle },
  { id: "appearance", label: "Appearance", Icon: Palette },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

const isSection = (value: string | null): value is Section =>
  SECTIONS.some((s) => s.id === value);

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsSections />
    </Suspense>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-3" aria-busy>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

/**
 * The section list. Every section is on the page at once; this scrolls to one,
 * and lights up whichever is in view. It stays in view beside the sections on
 * a wide screen and becomes a scrolling row on a narrow one.
 */
function SubNav({ active, onSelect }: { active: Section; onSelect: (id: Section) => void }) {
  return (
    <nav
      aria-label="Settings sections"
      className="no-scrollbar flex gap-1 overflow-x-auto lg:sticky lg:top-14 lg:flex-col lg:overflow-visible"
    >
      {SECTIONS.map(({ id, label, Icon }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? "location" : undefined}
            onClick={() => onSelect(id)}
            className={cn(
              "focus-visible:ring-ring/40 flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] outline-none focus-visible:ring-2",
              on
                ? "bg-accent text-accent-foreground font-medium"
                : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function SettingsSections() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  // The Upwork OAuth callback lands here with the outcome in the URL.
  const upworkOutcome = searchParams.get("upwork");
  const upworkNotice =
    upworkOutcome === "connected"
      ? { kind: "connected" as const }
      : upworkOutcome === "error"
        ? {
            kind: "error" as const,
            reason: searchParams.get("reason") ?? undefined,
          }
        : null;
  // A link that names a section opens there; so does the Upwork callback.
  const target: Section | null = isSection(requested)
    ? requested
    : upworkOutcome
      ? "integrations"
      : null;

  const [active, setActive] = useState<Section>(target ?? "profile");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => request<Settings>("/api/v1/settings"),
  });
  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: () => request<ModelRow[]>("/api/v1/settings/models"),
  });

  const patch = useMutation({
    mutationFn: (body: Partial<Settings>) =>
      request<Settings>("/api/v1/settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (s) => queryClient.setQueryData(["settings"], s),
  });

  const ready = !!data;

  const scrollTo = useCallback((id: Section, behavior: ScrollBehavior) => {
    document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
  }, []);

  // Deep links: the header menu names a section, and so can a shared link.
  // Sections only exist once the settings have loaded.
  useEffect(() => {
    if (!ready || !target) return;
    setActive(target);
    scrollTo(target, "auto");
  }, [ready, target, scrollTo]);

  // Light up the section being read.
  useEffect(() => {
    if (!ready) return;
    const elements = SECTIONS.map(({ id }) =>
      document.getElementById(id),
    ).filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) {
          const top = visible.sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
          setActive(top.target.id as Section);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ready]);

  if (isLoading || !data) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-40" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHero title="Settings" />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[10rem_minmax(0,1fr)] lg:items-start">
        <SubNav
          active={active}
          onSelect={(id) => {
            setActive(id);
            scrollTo(id, "smooth");
            // The section lives in the URL so the header menu can link straight to
            // one, and so a shared link opens where the sender was.
            router.replace(`/settings?tab=${id}`, { scroll: false });
          }}
        />

        <div className="min-w-0 space-y-3">
          <SettingsSection id="profile" title="Profile">
            <ProfileBody
              timezone={data.display_timezone}
              onTimezone={(display_timezone) => patch.mutate({ display_timezone })}
            />
          </SettingsSection>

          <SettingsSection id="models" title="Models">
            <ApiKeys credentials={data.credentials} />
            <SubHead className="mt-4">Model tiers</SubHead>
            <ModelTiers data={data} models={models ?? []} onPatch={patch.mutate} />
          </SettingsSection>

          <IntegrationsSection upworkNotice={upworkNotice} />

          <SettingsSection id="generation" title="Generation">
            <SettingRow label="Base country">
              {(control) => (
                <Input
                  {...control}
                  defaultValue={data.base_country}
                  onBlur={(e) =>
                    e.target.value !== data.base_country &&
                    patch.mutate({ base_country: e.target.value })
                  }
                />
              )}
            </SettingRow>
            {GENERATION_TOGGLES.map(([key, label]) => (
              <SettingRow key={key} label={label}>
                {(control) => (
                  <Switch
                    id={control.id}
                    checked={data[key]}
                    onCheckedChange={(checked) => patch.mutate({ [key]: checked })}
                  />
                )}
              </SettingRow>
            ))}
          </SettingsSection>

          <SettingsSection id="autofill" title="Autofill profile">
            <AutofillProfile />
          </SettingsSection>

          <SettingsSection id="extension" title="Extension">
            <ExtensionTokens />
          </SettingsSection>

          <SettingsSection id="appearance" title="Appearance">
            <AppearanceBody />
            <Rule />
            <AccountRow />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}

/**
 * The section for whichever job source the deployment uses.
 *
 * The source is chosen on the backend (FREELANCING_JOB_SOURCE), so the other
 * one's settings would only be noise here.
 */
function IntegrationsSection({
  upworkNotice,
}: {
  upworkNotice: { kind: "connected" | "error"; reason?: string } | null;
}) {
  const { data, isLoading } = useJobSource();
  return (
    <SettingsSection id="integrations" title={data ? `Integrations · ${data.label}` : "Integrations"}>
      {isLoading || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : data.key === "upwork" ? (
        <UpworkConnect notice={upworkNotice} />
      ) : (
        <ApifyConnect />
      )}
    </SettingsSection>
  );
}

/**
 * Profile.
 *
 * Everything except the display timezone is read-only: the API exposes no way
 * to change a name or an email, and a form that silently discarded them would
 * be worse than not offering them.
 */
function ProfileBody({
  timezone,
  onTimezone,
}: {
  timezone: string;
  onTimezone: (zone: string) => void;
}) {
  const { data: me } = useMe();
  const zones = TIME_ZONES.includes(timezone)
    ? TIME_ZONES
    : [timezone, ...TIME_ZONES];

  return (
    <>
      <div className="flex items-center gap-3 pb-1">
        <Avatar className="size-9">
          <AvatarFallback className="bg-accent text-accent-foreground text-xs font-semibold">
            {initialsOf(me)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{nameOf(me)}</p>
          <p className="text-muted-foreground truncate text-xs">{me?.email}</p>
        </div>
        <Badge variant="outline">Read-only</Badge>
      </div>

      <SettingRow label="Display timezone" className="mt-2">
        {(control) => (
          <Select value={timezone} onValueChange={onTimezone}>
            <SelectTrigger {...control} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingRow>
    </>
  );
}

function ApiKeys({ credentials }: { credentials: Credential[] }) {
  const queryClient = useQueryClient();
  const [keyInput, setKeyInput] = useState("");
  const [keyProvider, setKeyProvider] = useState("anthropic");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const saveKey = useMutation({
    mutationFn: () =>
      request("/api/v1/settings/api-key", {
        method: "PUT",
        body: JSON.stringify({ provider: keyProvider, api_key: keyInput }),
      }),
    onSuccess: () => {
      setKeyInput("");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const test = useMutation({
    mutationFn: () =>
      request<{ ok: boolean; detail: string; model: string }>(
        "/api/v1/settings/test-connection",
        { method: "POST" },
      ),
    onSuccess: (r) => {
      setTestResult({
        ok: r.ok,
        text: r.ok ? `Connected to ${r.model}` : r.detail,
      });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => setTestResult({ ok: false, text: (e as Error).message }),
  });

  return (
    <>
      <SubHead>API keys</SubHead>
      <ul>
        {credentials.map((c) => (
          <li key={c.provider}>
            <Row icon={KeyRound} className="sm:flex-nowrap">
              <span className="w-24 shrink-0 text-[13px] font-medium">
                {PROVIDER_LABEL[c.provider] ?? c.provider}
              </span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
                {c.masked_key}
              </span>
              <StatusBadge tone={CREDENTIAL_TONE[c.status] ?? "neutral"}>{c.status}</StatusBadge>
            </Row>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <FormField label="Provider" className="w-full sm:w-40 sm:flex-none">
          {(control) => (
            <Select value={keyProvider} onValueChange={setKeyProvider}>
              <SelectTrigger {...control} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="API key" className="min-w-56 flex-1">
          {(control) => (
            <Input
              {...control}
              type="password"
              placeholder="sk-ant-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
          )}
        </FormField>
        <Button disabled={keyInput.length < 12 || saveKey.isPending} onClick={() => saveKey.mutate()}>
          {saveKey.isPending ? <Spinner /> : <Save />}
          Save key
        </Button>
        <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? <Spinner /> : <PlugZap />}
          Test connection
        </Button>
      </div>

      {testResult && (
        <p
          className={cn(
            "mt-2 flex items-center gap-1.5 text-[13px] font-medium",
            testResult.ok ? "text-success" : "text-destructive",
          )}
        >
          {testResult.ok && <Check className="size-3.5" />}
          {testResult.text}
        </p>
      )}
      {saveKey.isError && (
        <div className="mt-2">
          <ErrorAlert>{(saveKey.error as Error).message}</ErrorAlert>
        </div>
      )}
    </>
  );
}

function ModelTiers({
  data,
  models,
  onPatch,
}: {
  data: Settings;
  models: ModelRow[];
  onPatch: (body: Partial<Settings>) => void;
}) {
  // Any of the provider's models can run any tier; the tier on a model is only
  // where it fits best.
  const available = models.filter((m) => m.provider === data.default_provider);

  return (
    <div>
      <SettingRow label="Provider">
        {(control) => (
          <Select value={data.default_provider} onValueChange={(v) => onPatch({ default_provider: v })}>
            <SelectTrigger {...control} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        )}
      </SettingRow>

      {(
        [
          ["heavy_model", "Heavy · scenario and drafting"],
          ["mid_model", "Mid · short edits"],
          ["fast_model", "Fast · form answers"],
        ] as const
      ).map(([key, label]) => (
        <SettingRow key={key} label={label}>
          {(control) => (
            <Select value={data[key]} onValueChange={(v) => onPatch({ [key]: v })}>
              <SelectTrigger {...control} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!available.some((m) => m.model_id === data[key]) && (
                  <SelectItem value={data[key]}>{data[key]}</SelectItem>
                )}
                {available.map((m) => (
                  <SelectItem key={m.model_id} value={m.model_id}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
      ))}
    </div>
  );
}

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

function AppearanceBody() {
  const { theme, setTheme } = useTheme();
  const { palette, setPalette } = usePalette();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div>
      <SettingRow label="Mode">
        {() => (
          <div role="radiogroup" aria-label="Mode" className="inline-flex gap-1">
            {THEMES.map(({ value, label, Icon }) => {
              const active = mounted && theme === value;
              return (
                <Button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setTheme(value)}
                >
                  <Icon />
                  {label}
                </Button>
              );
            })}
          </div>
        )}
      </SettingRow>

      <SettingRow label="Palette">
        {() => (
          <div role="radiogroup" aria-label="Palette" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PALETTES.map(({ id, name, swatches }) => {
              const active = palette === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPalette(id)}
                  className={cn(
                    "focus-visible:ring-ring/40 flex h-8 items-center gap-2 rounded-md border px-2 text-left text-xs outline-none focus-visible:ring-2",
                    active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="flex">
                    {swatches.map((color) => (
                      <span
                        key={color}
                        aria-hidden
                        style={{ backgroundColor: color }}
                        className="ring-card -ml-1 size-3.5 rounded-full ring-1 first:ml-0"
                      />
                    ))}
                  </span>
                  <span className="truncate font-medium">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </SettingRow>
    </div>
  );
}

function AccountRow() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-[13px] font-medium">Sign out of this device</span>
      <Button
        variant="outline"
        onClick={() => {
          authTokens.clear();
          queryClient.clear();
          router.replace("/login");
        }}
      >
        <LogOut />
        Sign out
      </Button>
    </div>
  );
}

interface TokenRow {
  id: string;
  name: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Long-lived tokens for the browser side panel, which cannot share a session. */
function ExtensionTokens() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Chrome side panel");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pack = useExtensionPackage();

  const { data } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => request<TokenRow[]>("/api/v1/auth/tokens"),
  });

  const create = useMutation({
    mutationFn: () =>
      request<TokenRow & { token: string }>("/api/v1/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (row) => {
      setFresh(row.token);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      request(`/api/v1/auth/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  const active = data?.filter((t) => !t.revoked_at) ?? [];
  const pkg = pack.data;

  return (
    <>
      {fresh && (
        <div role="alert" className="bg-accent mb-3 rounded-md p-3">
          <div className="text-accent-foreground flex items-center gap-2 text-[13px] font-semibold">
            <KeyRound className="size-4" />
            Copy this now — it will not be shown again.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="bg-card flex h-8 min-w-0 flex-1 basis-56 items-center rounded-md border px-2.5 font-mono text-xs">
              <span className="truncate">{fresh}</span>
            </code>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(fresh);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button onClick={() => setFresh(null)}>Done</Button>
          </div>
        </div>
      )}

      {active.length ? (
        <ul>
          {active.map((t) => (
            <li key={t.id}>
              <Row icon={Puzzle} className="sm:flex-nowrap">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t.last_used_at
                    ? `used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : "never used"}
                </span>
                <Button
                  size="icon-xs"
                  variant="destructive"
                  aria-label={`Revoke ${t.name}`}
                  onClick={() => revoke.mutate(t.id)}
                >
                  <Trash2 />
                </Button>
              </Row>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">No active tokens.</p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <FormField label="Token name" className="min-w-48 flex-1">
          {(control) => (
            <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </FormField>
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Spinner /> : <Plus />}
          Create token
        </Button>
      </div>

      <Rule />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Browser extension package</div>
          <div className="text-muted-foreground text-xs">
            {pack.isLoading
              ? "Checking…"
              : pkg?.available
                ? `Packaged ${new Date(pkg.builtAt!).toLocaleDateString()} · ${formatBytes(pkg.bytes!)}`
                : "Not packaged yet"}
          </div>
        </div>
        <DownloadExtension showSize={false} />
      </div>
    </>
  );
}
