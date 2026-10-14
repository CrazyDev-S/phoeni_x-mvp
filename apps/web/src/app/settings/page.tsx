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
  Package,
  Palette,
  Plug,
  PlugZap,
  Plus,
  Puzzle,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  Wand2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
} from "react";

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
  Hint,
  Row,
  Rule,
  SettingsSection,
  SubHead,
} from "@/components/settings/section";
import { CheckList, SidePanel } from "@/components/side-panel";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Tile } from "@/components/tile";
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

interface StorageNote {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
}

const STORAGE_NOTES: StorageNote[] = [
  {
    Icon: Lock,
    title: "API keys are encrypted at rest",
    detail:
      "The API never returns one — only a mask and a status you can check.",
  },
  {
    Icon: Plug,
    title: "Job-source tokens are encrypted too",
    detail:
      "An Apify token or an Upwork key pair is sealed like an API key; only a mask is shown.",
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
    <div className="space-y-8" aria-busy>
      <Skeleton className="h-12 w-56" />
      <Skeleton className="h-10 w-full max-w-2xl" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

/**
 * The sub-navigation. Every section is on the page at once; this scrolls to
 * one, and lights up whichever is in view. It stays in view beside the
 * sections on a wide screen and becomes a scrolling row of pills on a narrow one.
 */
function SubNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (id: Section) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="bg-card shadow-card no-scrollbar flex gap-1 overflow-x-auto rounded-full p-2 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible lg:rounded-[36px] lg:p-3"
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
              "focus-visible:ring-ring/40 flex h-[54px] shrink-0 items-center gap-3.5 rounded-full pr-5 pl-3 text-[0.96rem] font-semibold transition-colors outline-none focus-visible:ring-3",
              on
                ? "bg-primary text-primary-foreground"
                : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-[34px] place-items-center rounded-full [&_svg]:size-[17px]",
                on
                  ? "bg-brand text-brand-foreground"
                  : "bg-soft text-muted-foreground",
              )}
            >
              <Icon />
            </span>
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
    <div className="space-y-7">
      <PageHero
        title="Settings"
        description="Your account, the models that do the work, the services PhoeniX connects to, and how the generator behaves."
      />

      <div className="grid gap-6 lg:grid-cols-[296px_minmax(0,1fr)] lg:items-start">
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

        <div className="min-w-0 space-y-6">
          <SettingsSection
            id="profile"
            icon={UserRound}
            title="Profile"
            description="Who you are signed in as."
          >
            <ProfileBody
              timezone={data.display_timezone}
              onTimezone={(display_timezone) =>
                patch.mutate({ display_timezone })
              }
            />
          </SettingsSection>

          <SettingsSection
            id="models"
            icon={Cpu}
            title="Models"
            description="The keys the models run on, and which model runs each tier of work."
          >
            <ApiKeys credentials={data.credentials} />
            <SubHead className="mt-9">Model tiers</SubHead>
            <ModelTiers
              data={data}
              models={models ?? []}
              onPatch={patch.mutate}
            />
          </SettingsSection>

          <IntegrationsSection upworkNotice={upworkNotice} />

          <SettingsSection
            id="generation"
            icon={Sparkles}
            title="Generation"
            description="How the generator sources and names the companies it writes about."
          >
            <FormField
              className="max-w-[420px]"
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

            <Rule className="mt-7 mb-1.5" />

            <div>
              {GENERATION_TOGGLES.map(([key, label, hint]) => (
                <div
                  key={key}
                  className="border-border flex items-start gap-5 py-[22px] not-first:border-t sm:gap-[22px]"
                >
                  <label
                    htmlFor={key}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="block text-[1.03rem] font-semibold">
                      {label}
                    </span>
                    <span className="text-muted-foreground mt-1 block max-w-[640px] text-sm leading-normal font-medium">
                      {hint}
                    </span>
                  </label>
                  <Switch
                    id={key}
                    className="mt-0.5"
                    checked={data[key]}
                    onCheckedChange={(checked) =>
                      patch.mutate({ [key]: checked })
                    }
                  />
                </div>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            id="autofill"
            icon={Wand2}
            title="Autofill profile"
            description="What the extension answers application forms with. The form filler is not allowed to invent a phone number or a notice period — if it is not here, it hands the field back to you."
          >
            <AutofillProfile />
          </SettingsSection>

          <SettingsSection
            id="extension"
            icon={Puzzle}
            title="Extension tokens"
            description="The browser extension authenticates with its own long-lived token. Only a hash is stored, so the value is shown exactly once."
          >
            <ExtensionTokens />
          </SettingsSection>

          <SettingsSection
            id="appearance"
            icon={Palette}
            title="Appearance"
            description="Light or dark on this device. Each portal brings its own accent colour."
          >
            <AppearanceBody />
            <Rule />
            <AccountRow />
          </SettingsSection>

          <div className="grid items-stretch gap-6 lg:grid-cols-2">
            <SidePanel
              tone="dark"
              icon={ShieldCheck}
              title="How this is stored"
              className="rounded-[40px] [--card-spacing:--spacing(8)]"
            >
              <ul className="space-y-[18px]">
                {STORAGE_NOTES.map(({ Icon, title, detail }) => (
                  <li key={title} className="flex gap-3">
                    <span className="bg-panel-raised text-brand grid size-[34px] shrink-0 place-items-center rounded-full [&_svg]:size-4">
                      <Icon />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-panel-muted mt-0.5 text-[0.78rem] leading-snug font-medium">
                        {detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </SidePanel>
            <SidePanel
              tone="soft"
              icon={Lightbulb}
              title="Tips"
              className="rounded-[40px] [--card-spacing:--spacing(8)]"
            >
              <CheckList items={SETTINGS_TIPS} />
            </SidePanel>
          </div>
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
    <SettingsSection
      id="integrations"
      icon={Plug}
      title="Integrations"
      description={
        data ? (
          <>
            Freelancing job search runs through{" "}
            <strong className="text-foreground">{data.label}</strong>. The
            backend chooses it with{" "}
            <code className="font-mono text-[0.8125rem]">
              FREELANCING_JOB_SOURCE
            </code>
            .
          </>
        ) : undefined
      }
    >
      {isLoading || !data ? (
        <Skeleton className="h-64 w-full rounded-[30px]" />
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
      <div className="flex flex-wrap items-center gap-5">
        <Avatar className="size-20">
          <AvatarFallback className="bg-accent text-accent-foreground text-2xl font-semibold">
            {initialsOf(me)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-semibold tracking-tight">
            {nameOf(me)}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-[0.97rem] font-medium">
            {me?.email}
          </p>
        </div>
        <Badge variant="outline">Read-only</Badge>
      </div>

      <Rule />

      <FormField
        className="max-w-[420px]"
        label="Display timezone"
        hint="Every time in the app is rendered in this zone, never the browser's."
      >
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
      </FormField>

      <Hint quiet className="mt-[22px]">
        Name and email are set at registration and cannot be changed here yet.
      </Hint>
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
      <Hint className="-mt-1 mb-4">
        Keys are encrypted at rest and are never returned by the API — only a
        mask and a status.
      </Hint>
      <ul className="space-y-2.5">
        {credentials.map((c) => (
          <li key={c.provider}>
            <Row icon={KeyRound} className="sm:flex-nowrap">
              <span className="w-24 shrink-0 text-[0.96rem] font-semibold">
                {PROVIDER_LABEL[c.provider] ?? c.provider}
              </span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[13px]">
                {c.masked_key}
              </span>
              <StatusBadge tone={CREDENTIAL_TONE[c.status] ?? "neutral"}>
                {c.status}
              </StatusBadge>
            </Row>
          </li>
        ))}
      </ul>

      <div className="mt-[22px] flex flex-wrap items-end gap-3">
        <FormField label="Provider" className="w-full sm:w-48 sm:flex-none">
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
          size="lg"
          disabled={keyInput.length < 12 || saveKey.isPending}
          onClick={() => saveKey.mutate()}
        >
          {saveKey.isPending ? <Spinner /> : <Save />}
          Save key
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending ? <Spinner /> : <PlugZap />}
          Test connection
        </Button>
      </div>

      {testResult && (
        <p
          className={cn(
            "mt-4 flex items-center gap-2 text-sm font-semibold",
            testResult.ok ? "text-success" : "text-destructive",
          )}
        >
          {testResult.ok && <Check className="size-[17px] stroke-[2.4]" />}
          {testResult.text}
        </p>
      )}
      {saveKey.isError && (
        <div className="mt-4">
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
    <div className="grid gap-5 sm:grid-cols-2">
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
            <Select
              value={data[key]}
              onValueChange={(v) => onPatch({ [key]: v })}
            >
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
        </FormField>
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-2.5">
      <p id="appearance-mode" className="text-sm font-medium">
        Mode
      </p>
      <div
        role="radiogroup"
        aria-labelledby="appearance-mode"
        className="grid max-w-[510px] grid-cols-3 gap-3.5"
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
              className={cn(
                "focus-visible:ring-ring/40 flex h-[104px] flex-col items-center justify-center gap-2.5 rounded-[26px] text-[0.94rem] font-semibold transition-colors outline-none focus-visible:ring-3",
                active
                  ? "bg-primary text-primary-foreground [&_svg]:text-brand"
                  : "bg-soft text-foreground/70 hover:bg-soft-2",
              )}
            >
              <Icon className="size-[22px]" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AccountRow() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Tile icon={LogOut} size="lg" tone="soft" />
      <div className="min-w-0 flex-1">
        <div className="text-[1.03rem] font-semibold">Account</div>
        <div className="text-muted-foreground mt-0.5 text-[0.8125rem] font-medium">
          Sessions on this device.
        </div>
      </div>
      <Button
        size="lg"
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
        <div role="alert" className="bg-accent mb-5 rounded-[26px] p-5">
          <div className="text-accent-foreground flex items-center gap-2.5 text-[0.96rem] font-bold">
            <KeyRound className="size-[18px]" />
            Copy this now — it will not be shown again.
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <code className="bg-card flex min-h-[52px] min-w-0 flex-1 basis-56 items-center rounded-[18px] px-[18px] font-mono text-[13px]">
              <span className="truncate">{fresh}</span>
            </code>
            <Button
              variant="outline"
              className="bg-card h-[52px]"
              onClick={() => {
                void navigator.clipboard.writeText(fresh);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button className="h-[52px]" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {active.length ? (
        <ul className="space-y-2.5">
          {active.map((t) => (
            <li key={t.id}>
              <Row icon={Puzzle} className="sm:flex-nowrap">
                <span className="min-w-0 flex-1 truncate text-[0.96rem] font-semibold">
                  {t.name}
                </span>
                <span className="text-muted-foreground shrink-0 text-[0.8125rem] font-medium">
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
              </Row>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No active tokens.</p>
      )}

      <div className="mt-[22px] flex flex-wrap items-end gap-3">
        <FormField label="Token name" className="min-w-48 flex-1">
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </FormField>
        <Button
          size="lg"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? <Spinner /> : <Plus />}
          Create token
        </Button>
      </div>

      <Rule />

      <div className="flex flex-wrap items-center gap-4">
        <Tile icon={Package} size="lg" tone="soft" />
        <div className="min-w-0 flex-1">
          <div className="text-[1.03rem] font-semibold">
            Browser extension package
          </div>
          <div className="text-muted-foreground mt-0.5 text-[0.8125rem] font-medium">
            {pack.isLoading
              ? "Checking…"
              : pkg?.available
                ? `Packaged ${new Date(pkg.builtAt!).toLocaleDateString()} · ${formatBytes(pkg.bytes!)}`
                : "Not packaged yet"}
          </div>
        </div>
        <DownloadExtension
          showSize={false}
          className="border-foreground/20 h-12 border-[1.5px] shadow-none"
        />
      </div>
    </>
  );
}
