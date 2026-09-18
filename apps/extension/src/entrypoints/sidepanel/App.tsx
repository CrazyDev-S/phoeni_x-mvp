import { Briefcase, CalendarDays, Settings2, Sparkles, Wrench } from "lucide-react";
import { useCallback, useEffect, useState, type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, getSettings } from "@/lib/api";
import { DEFAULT_PORTAL_URL, NEXT_CALL_KEY, ROUTE_KEY } from "@/lib/constants";
import { ApplyTab } from "./tabs/Apply";
import { CalendarTab } from "./tabs/Calendar";
import { GenerateTab } from "./tabs/Generate";
import { MaintainTab } from "./tabs/Maintain";
import { SettingsTab } from "./tabs/Settings";
import { PanelFooter, PanelHeader, type Connection } from "./chrome-shell";
import { NextCall, type Upcoming } from "./components";

type Route = "apply" | "generate" | "calendar" | "maintain" | "settings";

const TABS: {
  key: Route;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "apply", label: "Apply", Icon: Briefcase },
  { key: "generate", label: "Generate", Icon: Sparkles },
  { key: "calendar", label: "Calendar", Icon: CalendarDays },
  { key: "maintain", label: "Jobs", Icon: Wrench },
  { key: "settings", label: "Settings", Icon: Settings2 },
];

function manifestVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

export function App() {
  const [route, setRoute] = useState<Route>("apply");
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection>("checking");
  const [portalUrl, setPortalUrl] = useState(DEFAULT_PORTAL_URL);
  const [next, setNext] = useState<Upcoming | null>(null);

  /** One round trip that proves the base URL and the token both work. */
  const check = useCallback(async () => {
    setConnection("checking");
    const settings = await getSettings();
    setPortalUrl(settings.portalUrl);
    if (!settings.token) {
      setConnection("unconfigured");
      return;
    }
    try {
      await api("/api/v1/auth/me");
      setConnection("ok");
    } catch {
      setConnection("error");
    }
  }, []);

  useEffect(() => {
    // The panel document is destroyed when the panel closes, so the last route
    // is restored from session storage rather than kept in memory.
    void chrome.storage.session.get(ROUTE_KEY).then((s) => {
      const stored = (s as Record<string, string | undefined>)[ROUTE_KEY];
      if (stored) setRoute(stored as Route);
    });
    void check().finally(() => setReady(true));
    void chrome.storage.local
      .get(NEXT_CALL_KEY)
      .then((s) =>
        setNext((s as Record<string, Upcoming | undefined>)[NEXT_CALL_KEY] ?? null),
      );

    // The service worker writes the next call here on its alarm. storage
    // events are idempotent and survive the panel being closed, which
    // runtime.sendMessage would not.
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[NEXT_CALL_KEY]) {
        setNext((changes[NEXT_CALL_KEY].newValue as Upcoming | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [check]);

  function go(next: Route) {
    setRoute(next);
    void chrome.storage.session.set({ [ROUTE_KEY]: next });
  }

  const configured = connection === "ok" || connection === "error";

  return (
    <div className="bg-background flex min-h-svh flex-col">
      <PanelHeader
        state={connection}
        portalUrl={portalUrl}
        onRefresh={() => void check()}
      />

      <Tabs
        value={route}
        onValueChange={(value) => go(value as Route)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList
          variant="line"
          className="bg-card h-auto! w-full shrink-0 gap-0 rounded-none border-b p-0"
        >
          {TABS.map(({ key, label, Icon }) => (
            <TabsTrigger
              key={key}
              value={key}
              title={label}
              // The underline takes the primary too, so the active tab is one
              // colour rather than orange text over a black rule.
              className="h-auto! flex-col gap-1 rounded-none px-1 py-2 text-[10px] font-medium after:bg-primary! data-active:text-primary"
            >
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex flex-1 flex-col gap-3 p-3">
          {!ready ? (
            <div className="space-y-3" aria-busy>
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : (
            <>
              <NextCall upcoming={next} />

              {!configured && route !== "settings" ? (
                <Connect onOpenSettings={() => go("settings")} />
              ) : (
                <>
                  <TabsContent value="apply" className="flex flex-col gap-3">
                    <ApplyTab portalUrl={portalUrl} />
                  </TabsContent>
                  <TabsContent value="generate">
                    <GenerateTab />
                  </TabsContent>
                  <TabsContent value="calendar">
                    <CalendarTab />
                  </TabsContent>
                  <TabsContent value="maintain" className="flex flex-col gap-3">
                    <MaintainTab />
                  </TabsContent>
                  <TabsContent value="settings">
                    <SettingsTab onSaved={() => void check()} />
                  </TabsContent>
                </>
              )}
            </>
          )}
        </div>
      </Tabs>

      <PanelFooter state={connection} portalUrl={portalUrl} version={manifestVersion()} />
    </div>
  );
}

function Connect({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4 text-center">
      <span className="bg-accent text-accent-foreground mx-auto flex size-9 items-center justify-center rounded-full">
        <Settings2 className="size-4" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">Connect the panel</p>
        <p className="text-muted-foreground text-xs leading-relaxed text-balance">
          Point it at your Phoenix Eye backend and paste an access token to get started.
        </p>
      </div>
      <Button className="w-full" onClick={onOpenSettings}>
        <Settings2 />
        Open settings
      </Button>
    </div>
  );
}
