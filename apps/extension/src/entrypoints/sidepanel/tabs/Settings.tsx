import { Check, KeyRound, Link2, Plug } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { api, getSettings, saveSettings } from "@/lib/api";
import { DEFAULT_API_BASE, DEFAULT_PORTAL_URL } from "@/lib/constants";
import { Section } from "../chrome-shell";
import { ErrorNote, PanelField } from "../components";

export function SettingsTab({ onSaved }: { onSaved: () => void }) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [portalUrl, setPortalUrl] = useState(DEFAULT_PORTAL_URL);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSettings().then((s) => {
      setApiBase(s.apiBase);
      setPortalUrl(s.portalUrl);
      setToken(s.token);
    });
  }, []);

  async function save() {
    setError(null);
    setStatus(null);
    setBusy(true);
    await saveSettings({ apiBase, token, portalUrl });
    try {
      const me = await api<{ email: string }>("/api/v1/auth/me");
      setStatus(me.email);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Section title="Connection">
        <Card className="py-3">
          <CardContent className="px-3">
            <FieldGroup className="gap-3">
              <PanelField label="Backend URL">
                {(control) => (
                  <Input
                    {...control}
                    value={apiBase}
                    onChange={(e) => setApiBase(e.target.value)}
                    placeholder={DEFAULT_API_BASE}
                  />
                )}
              </PanelField>

              <PanelField label="Web portal URL" hint="Used by the “open in portal” links.">
                {(control) => (
                  <Input
                    {...control}
                    value={portalUrl}
                    onChange={(e) => setPortalUrl(e.target.value)}
                    placeholder={DEFAULT_PORTAL_URL}
                  />
                )}
              </PanelField>

              <PanelField label="Access token">
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="rat_…"
                  />
                )}
              </PanelField>

              <Button className="h-10 w-full" disabled={busy} onClick={save}>
                {busy ? <Spinner /> : <Plug />}
                Save &amp; test
              </Button>

              {status && (
                <p className="text-success flex items-center gap-1.5 text-xs">
                  <Check className="size-3.5 shrink-0" />
                  Connected as {status}
                </p>
              )}
              {error && <ErrorNote>{error}</ErrorNote>}
            </FieldGroup>
          </CardContent>
        </Card>
      </Section>

      <Section title="Getting a token">
        <Card className="py-3">
          <CardContent className="space-y-2.5 px-3">
            <Step icon={Link2} n={1}>
              Open the web portal and go to <strong>Settings → Extension</strong>.
            </Step>
            <Separator />
            <Step icon={KeyRound} n={2}>
              Create a token. Only a hash is stored, so the value is shown exactly once.
            </Step>
            <Separator />
            <Step icon={Plug} n={3}>
              Paste it above and press <strong>Save &amp; test</strong>.
            </Step>
            <p className="text-subtle pt-1 text-[10px] leading-relaxed">
              The token is kept in this browser&rsquo;s local storage and is never synced.
            </p>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

function Step({
  icon: Icon,
  n,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  n: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="bg-accent text-accent-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
        {n}
      </span>
      <p className="text-muted-foreground flex-1 text-[11px] leading-relaxed">{children}</p>
      <Icon className="text-subtle mt-1 size-3 shrink-0" />
    </div>
  );
}
