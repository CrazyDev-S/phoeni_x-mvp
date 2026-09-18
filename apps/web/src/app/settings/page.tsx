"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Cpu,
  KeyRound,
  Lightbulb,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Plus,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  User,
  Wand2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AutofillProfileCard } from "@/components/autofill-profile-card";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { PageHero } from "@/components/page-hero";
import { CheckList, PointList, SidePanel, type PointItem } from "@/components/side-panel";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { initialsOf, nameOf, useMe } from "@/hooks/use-me";
import { usePalette } from "@/hooks/use-palette";
import { request, tokens as authTokens } from "@/lib/api";
import { PALETTES } from "@/lib/palette";
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
  [
    "research_dossiers",
    "Research company dossiers",
    "Gives the model web search so every employer it names has a verified founding date, office, headcount and title ladder behind it. Required by the generator prompt.",
  ],
  [
    "strict_dossier",
    "Block employers with no sourced dossier",
    "Holds the resume back for review if a company is named without at least one retrieved source.",
  ],
  [
    "allow_real_company_names",
    "Name real companies",
    "Turning it off substitutes archetype descriptions (“a ~200-person Series B payments company”) instead, which reads weaker and has to be replaced by hand before sending.",
  ],
] as const;

const STORAGE_NOTES: PointItem[] = [
  {
    Icon: Lock,
    title: "API keys are encrypted at rest",
    detail: "The API never returns one — only a mask and a status you can check.",
  },
  {
    Icon: Puzzle,
    title: "Extension tokens are hashed",
    detail: "The value is shown exactly once, at the moment you create it.",
  },
  {
    Icon: Palette,
    title: "Theme is per device",
    detail: "It lives in this browser and is never synced to your account.",
  },
];

const SETTINGS_TIPS = [
  "Test the connection after saving a key — a bad key fails silently otherwise.",
  "Heavy runs the scenario and the drafting; fast only answers form fields.",
  "Turning off dossier research makes generated employers unverifiable.",
  "Revoke an extension token the moment a device is out of your hands.",
];

const SECTIONS = [
  "profile",
  "models",
  "generation",
  "autofill",
  "extension",
  "appearance",
] as const;
type Section = (typeof SECTIONS)[number];

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsSections />
    </Suspense>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <Skeleton className="h-12 w-56" />
      <Skeleton className="h-10 w-full max-w-2xl" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function SettingsSections() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const section: Section = SECTIONS.includes(requested as Section)
    ? (requested as Section)
    : "profile";

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

  if (isLoading || !data) {
    return (
      <div className="space-y-8" aria-busy>
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-full max-w-lg" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Configuration"
        eyebrowIcon={SlidersHorizontal}
        title="Settings"
        description="Your account, the models that do the work, and how the generator behaves."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0">
          <Tabs
            value={section}
            // The section lives in the URL so the header menu can link straight to
            // one, and so a shared link opens where the sender was.
            onValueChange={(next) =>
              router.replace(`/settings?tab=${next}`, { scroll: false })
            }
            className="gap-6"
          >
            <TabsList className="h-11 w-full max-w-2xl">
              <TabsTrigger value="profile" className="gap-1.5" title="Profile">
                <User className="size-4" />
                <span className="sr-only sm:not-sr-only">Profile</span>
              </TabsTrigger>
              <TabsTrigger value="models" className="gap-1.5" title="Models">
                <Cpu className="size-4" />
                <span className="sr-only sm:not-sr-only">Models</span>
              </TabsTrigger>
              <TabsTrigger value="generation" className="gap-1.5" title="Generation">
                <Sparkles className="size-4" />
                <span className="sr-only sm:not-sr-only">Generation</span>
              </TabsTrigger>
              <TabsTrigger value="autofill" className="gap-1.5" title="Autofill">
                <Wand2 className="size-4" />
                <span className="sr-only sm:not-sr-only">Autofill</span>
              </TabsTrigger>
              <TabsTrigger value="extension" className="gap-1.5" title="Extension">
                <Puzzle className="size-4" />
                <span className="sr-only sm:not-sr-only">Extension</span>
              </TabsTrigger>
              <TabsTrigger value="appearance" className="gap-1.5" title="Appearance">
                <Palette className="size-4" />
                <span className="sr-only sm:not-sr-only">Appearance</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-6">
              <ProfileCard
                timezone={data.display_timezone}
                onTimezone={(display_timezone) => patch.mutate({ display_timezone })}
              />
            </TabsContent>

            <TabsContent value="models" className="space-y-6">
              <ApiKeysCard credentials={data.credentials} />
              <ModelsCard data={data} models={models ?? []} onPatch={patch.mutate} />
            </TabsContent>

            <TabsContent value="generation">
              <Card>
                <CardHeader>
                  <CardTitle>Generation</CardTitle>
                  <CardDescription>
                    How the generator sources and names the companies it writes about.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    label="Base country"
                    hint="Overrides the generator prompt's default. Sets the universities, academic calendar and work-mode timeline used for constructed scenarios."
                  >
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
                  </FormField>

                  <Separator />

                  {GENERATION_TOGGLES.map(([key, label, hint]) => (
                    <Field key={key} orientation="horizontal">
                      <FieldLabel htmlFor={key}>
                        <div className="space-y-0.5">
                          <FieldTitle>{label}</FieldTitle>
                          <FieldDescription>{hint}</FieldDescription>
                        </div>
                      </FieldLabel>
                      <Switch
                        id={key}
                        checked={data[key]}
                        onCheckedChange={(checked) => patch.mutate({ [key]: checked })}
                      />
                    </Field>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="autofill">
              <AutofillProfileCard />
            </TabsContent>

            <TabsContent value="extension">
              <ExtensionTokens />
            </TabsContent>

            <TabsContent value="appearance" className="space-y-6">
              <AppearanceCard />
              <AccountCard />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <SidePanel icon={ShieldCheck} title="How this is stored">
            <PointList items={STORAGE_NOTES} />
          </SidePanel>
          <SidePanel icon={Lightbulb} title="Tips">
            <CheckList items={SETTINGS_TIPS} />
          </SidePanel>
        </aside>
      </div>
    </div>
  );
}

/**
 * Profile.
 *
 * Everything except the display timezone is read-only: the API exposes no way
 * to change a name or an email, and a form that silently discarded them would
 * be worse than not offering them.
 */
function ProfileCard({
  timezone,
  onTimezone,
}: {
  timezone: string;
  onTimezone: (zone: string) => void;
}) {
  const { data: me } = useMe();
  const zones = TIME_ZONES.includes(timezone) ? TIME_ZONES : [timezone, ...TIME_ZONES];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Who you are signed in as.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-accent text-accent-foreground text-lg font-semibold">
              {initialsOf(me)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{nameOf(me)}</p>
            <p className="text-muted-foreground truncate text-sm">{me?.email}</p>
          </div>
        </div>

        <Separator />

        <FormField
          label="Display timezone"
          hint="Every time in the app is rendered in this zone, never the browser's."
        >
          {(control) => (
            <Select value={timezone} onValueChange={onTimezone}>
              <SelectTrigger {...control} className="w-full sm:w-72">
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
        </FormField>

        <p className="text-subtle text-xs">
          Name and email are set at registration and cannot be changed here yet.
        </p>
      </CardContent>
    </Card>
  );
}

function ApiKeysCard({ credentials }: { credentials: Credential[] }) {
  const queryClient = useQueryClient();
  const [keyInput, setKeyInput] = useState("");
  const [keyProvider, setKeyProvider] = useState("anthropic");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

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
      setTestResult({ ok: r.ok, text: r.ok ? `Connected to ${r.model}` : r.detail });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => setTestResult({ ok: false, text: (e as Error).message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Keys are encrypted at rest and are never returned by the API — only a mask and a
          status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="space-y-2">
          {credentials.map((c) => (
            <li
              key={c.provider}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
            >
              <KeyRound className="text-muted-foreground size-4 shrink-0" />
              <span className="w-20 text-sm font-medium capitalize">{c.provider}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
                {c.masked_key}
              </span>
              <StatusBadge tone={CREDENTIAL_TONE[c.status] ?? "neutral"}>
                {c.status}
              </StatusBadge>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Provider" className="w-40">
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
          <Button
            disabled={keyInput.length < 12 || saveKey.isPending}
            onClick={() => saveKey.mutate()}
          >
            {saveKey.isPending && <Spinner />}
            Save key
          </Button>
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending && <Spinner />}
            Test connection
          </Button>
        </div>

        {testResult && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm",
              testResult.ok ? "text-success" : "text-destructive",
            )}
          >
            {testResult.ok && <Check className="size-4" />}
            {testResult.text}
          </p>
        )}
        {saveKey.isError && <ErrorAlert>{(saveKey.error as Error).message}</ErrorAlert>}
      </CardContent>
    </Card>
  );
}

function ModelsCard({
  data,
  models,
  onPatch,
}: {
  data: Settings;
  models: ModelRow[];
  onPatch: (body: Partial<Settings>) => void;
}) {
  const byTier = (tier: string) =>
    models.filter((m) => m.provider === data.default_provider && m.tier === tier);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription>
          Which model runs each tier of work, for the selected provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <FormField label="Provider">
          {(control) => (
            <Select
              value={data.default_provider}
              onValueChange={(v) => onPatch({ default_provider: v })}
            >
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

        {(
          [
            ["heavy_model", "Heavy — scenario and drafting"],
            ["mid_model", "Mid — short edits"],
            ["fast_model", "Fast — form answers"],
          ] as const
        ).map(([key, label]) => (
          <FormField key={key} label={label}>
            {(control) => (
              <Select value={data[key]} onValueChange={(v) => onPatch({ [key]: v })}>
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={data[key]}>{data[key]}</SelectItem>
                  {byTier(key.split("_")[0])
                    .filter((m) => m.model_id !== data[key])
                    .map((m) => (
                      <SelectItem key={m.model_id} value={m.model_id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        ))}
      </CardContent>
    </Card>
  );
}

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/** One tile in an Appearance radio group; mode and palette tiles look alike. */
function choiceClass(active: boolean) {
  return cn(
    "focus-visible:ring-ring flex flex-col items-center gap-2 rounded-xl border p-4 transition-all duration-150 focus-visible:ring-3 focus-visible:outline-none",
    active
      ? "border-primary bg-accent text-accent-foreground"
      : "hover:bg-muted text-muted-foreground",
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const { palette, setPalette } = usePalette();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>How the app looks on this device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p id="appearance-mode" className="text-sm font-medium">
            Mode
          </p>
          <div
            role="radiogroup"
            aria-labelledby="appearance-mode"
            className="grid max-w-md grid-cols-3 gap-3"
          >
            {THEMES.map(({ value, label, Icon }) => {
              const active = mounted && theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(value)}
                  className={choiceClass(active)}
                >
                  <Icon className="size-5" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p id="appearance-palette" className="text-sm font-medium">
            Palette
          </p>
          <div
            role="radiogroup"
            aria-labelledby="appearance-palette"
            className="grid max-w-md grid-cols-2 gap-3"
          >
            {PALETTES.map(({ value, label, swatches }) => {
              const active = mounted && palette === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPalette(value)}
                  className={choiceClass(active)}
                >
                  <span className="flex -space-x-1.5" aria-hidden>
                    {swatches.map((color) => (
                      <span
                        key={color}
                        className="border-card size-5 rounded-full border-2"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="text-sm font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Sessions on this device.</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
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
    mutationFn: (id: string) => request(`/api/v1/auth/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  const active = data?.filter((t) => !t.revoked_at) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Extension tokens</CardTitle>
        <CardDescription>
          The browser extension authenticates with its own long-lived token. Only a hash is
          stored, so the value is shown exactly once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {fresh && (
          <Alert>
            <KeyRound />
            <AlertTitle>Copy this now — it will not be shown again.</AlertTitle>
            <AlertDescription className="mt-2 flex w-full flex-wrap items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-xs">
                {fresh}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(fresh);
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
                Done
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {active.length ? (
          <ul className="space-y-2">
            {active.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
              >
                <Puzzle className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                <span className="text-subtle text-xs">
                  {t.last_used_at
                    ? `used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : "never used"}
                </span>
                <Button
                  size="icon-sm"
                  variant="destructive"
                  aria-label={`Revoke ${t.name}`}
                  onClick={() => revoke.mutate(t.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No active tokens.</p>
        )}

        <div className="flex flex-wrap items-end gap-3">
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
      </CardContent>
    </Card>
  );
}
