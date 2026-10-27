"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Plug,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Row, Rule } from "@/components/settings/section";
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
import { request } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { CONNECTION_LABEL, type UpworkConnection } from "@/lib/freelancing";

interface Organization {
  organization_id: string;
  title: string;
  type_title: string | null;
}

interface TestResult {
  ok: boolean;
  detail: string;
  upwork_user_name: string | null;
  organizations: Organization[];
}

export const CONNECTION_QUERY = ["freelancing", "upwork", "connection"];

export function useUpworkConnection() {
  return useQuery({
    queryKey: CONNECTION_QUERY,
    queryFn: () =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/connection"),
    staleTime: 30_000,
  });
}

/** One numbered step of the connection. */
function Step({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground mb-1.5 text-xs font-medium">{children}</p>;
}

/**
 * The Upwork link, in Settings.
 *
 * Two steps: an API key pair from upwork.com/developer/keys, then the OAuth
 * round trip. The redirect URI to register is shown because the two have to
 * match to the character, and a mismatch fails silently on Upwork's side.
 */
export function UpworkConnect({
  notice,
}: {
  notice?: { kind: "connected" | "error"; reason?: string } | null;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useUpworkConnection();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY });

  const saveCredentials = useMutation({
    mutationFn: () =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/credentials", {
        method: "PUT",
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        }),
      }),
    onSuccess: (row) => {
      queryClient.setQueryData(CONNECTION_QUERY, row);
      setClientId("");
      setClientSecret("");
    },
  });

  const removeCredentials = useMutation({
    mutationFn: () =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/credentials", {
        method: "DELETE",
      }),
    onSuccess: (row) => queryClient.setQueryData(CONNECTION_QUERY, row),
  });

  const authorize = useMutation({
    mutationFn: () =>
      request<{ url: string }>("/api/v1/freelancing/upwork/authorize", {
        method: "POST",
      }),
    // A full navigation: Upwork's sign-in page cannot be opened in a fetch.
    onSuccess: ({ url }) => window.location.assign(url),
  });

  const disconnect = useMutation({
    mutationFn: () =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/disconnect", {
        method: "POST",
      }),
    onSuccess: (row) => {
      queryClient.setQueryData(CONNECTION_QUERY, row);
      setTest(null);
    },
  });

  const runTest = useMutation({
    mutationFn: () =>
      request<TestResult>("/api/v1/freelancing/upwork/test", {
        method: "POST",
      }),
    onSuccess: (result) => {
      setTest(result);
      refresh();
    },
    onError: (error) =>
      setTest({
        ok: false,
        detail: (error as Error).message,
        upwork_user_name: null,
        organizations: [],
      }),
  });

  const setTenant = useMutation({
    mutationFn: (tenant_id: string | null) =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/tenant", {
        method: "PUT",
        body: JSON.stringify({ tenant_id }),
      }),
    onSuccess: (row) => queryClient.setQueryData(CONNECTION_QUERY, row),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const status = CONNECTION_LABEL[data.status];
  const error = (saveCredentials.error ??
    authorize.error ??
    disconnect.error ??
    removeCredentials.error) as Error | null;
  const organizations = test?.organizations ?? [];

  return (
    <>
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Upwork</h3>
          <StatusBadge tone={status.tone}>
            {data.connected && <Check />}
            {status.label}
          </StatusBadge>
          {data.credentials_source === "environment" && (
            <StatusBadge tone="neutral">Key pair from the server</StatusBadge>
          )}
        </div>
        <p className="text-muted-foreground mb-3 text-xs">
          API key from{" "}
          <a
            href="https://www.upwork.com/developer/keys"
            target="_blank"
            rel="noreferrer"
            className="text-foreground inline-flex items-center gap-1 font-medium underline underline-offset-2"
          >
            upwork.com/developer/keys
            <ExternalLink className="size-3" />
          </a>{" "}
          with the &ldquo;Read marketplace Job Postings&rdquo; permission.
        </p>

        <div className="space-y-2">
          {notice?.kind === "connected" && (
            <Alert>
              <Check />
              <AlertTitle>Upwork is connected.</AlertTitle>
              <AlertDescription>You can search jobs now.</AlertDescription>
            </Alert>
          )}
          {notice?.kind === "error" && (
            <ErrorAlert title="Upwork did not complete the sign-in">
              {notice.reason ?? "Try again."}
            </ErrorAlert>
          )}
          {data.last_error && data.status !== "connected" && (
            <ErrorAlert>{data.last_error}</ErrorAlert>
          )}
        </div>

        {/* Step 1: the redirect URI, and the key pair. */}
        <div
          className={
            notice || (data.last_error && data.status !== "connected")
              ? "mt-3"
              : undefined
          }
        >
          <Step>Register the redirect URI on the key</Step>
          <div className="flex items-center gap-2">
            <code className="bg-card text-muted-foreground flex min-h-8 min-w-0 flex-1 items-center truncate rounded-md border px-2.5 font-mono text-xs">
              <span className="truncate">{data.redirect_uri}</span>
            </code>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(data.redirect_uri);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <Rule className="my-3" />

        <div>
          <Step>API key pair</Step>
          {data.configured && data.credentials_source === "user" ? (
            <Row icon={KeyRound} tone="white">
              <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[13px]">
                {data.client_id} · {data.masked_client_secret}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={removeCredentials.isPending}
                onClick={() => removeCredentials.mutate()}
              >
                Replace
              </Button>
            </Row>
          ) : data.configured ? (
            <p className="text-muted-foreground text-sm">
              A key pair is set on the server ({data.client_id}). Add your own
              below to use it instead.
            </p>
          ) : null}
          {(!data.configured || data.credentials_source !== "user") && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <FormField label="Client ID" className="min-w-48 flex-1">
                {(control) => (
                  <Input
                    {...control}
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Client secret" className="min-w-48 flex-1">
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                )}
              </FormField>
              <Button
                disabled={
                  clientId.trim().length < 8 ||
                  clientSecret.trim().length < 8 ||
                  saveCredentials.isPending
                }
                onClick={() => saveCredentials.mutate()}
              >
                {saveCredentials.isPending && <Spinner />}
                Save key pair
              </Button>
            </div>
          )}
        </div>

        <Rule className="my-3" />

        {/* Step 3: authorize, or the connected account. */}
        <div>
          <Step>Authorize</Step>
          {data.connected ? (
            <div className="space-y-2">
              <Row icon={Link2} tone="white" iconTone="success">
                <span className="min-w-0 flex-1 text-[13px]">
                  Connected as{" "}
                  <strong>
                    {data.upwork_user_name ?? "your Upwork account"}
                  </strong>
                  {data.connected_at && (
                    <span className="text-subtle">
                      {" "}
                      · since {formatDateTime(data.connected_at, "d MMM")}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runTest.isPending}
                  onClick={() => runTest.mutate()}
                >
                  {runTest.isPending ? <Spinner /> : <RefreshCw />}
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  <Unplug />
                  Disconnect
                </Button>
              </Row>
              {test && (
                <p
                  className={
                    test.ok
                      ? "text-success flex items-center gap-2 text-sm font-semibold"
                      : "text-destructive text-sm font-semibold"
                  }
                >
                  {test.ok && <Check className="size-4 stroke-[2.4]" />}
                  {test.detail}
                </p>
              )}
              {organizations.length > 1 && (
                <FormField className="pt-1" label="Organization">
                  {(control) => (
                    <Select
                      value={data.tenant_id ?? ""}
                      onValueChange={(value) => setTenant.mutate(value || null)}
                    >
                      <SelectTrigger
                        {...control}
                        className="w-full bg-card sm:w-[420px]"
                      >
                        <SelectValue placeholder="Default organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem
                            key={org.organization_id}
                            value={org.organization_id}
                          >
                            {org.title}
                            {org.type_title ? ` · ${org.type_title}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="brand"
                disabled={!data.configured || authorize.isPending}
                onClick={() => authorize.mutate()}
              >
                {authorize.isPending ? <Spinner /> : <Plug />}
                {data.status === "expired" ? "Connect again" : "Connect Upwork"}
              </Button>
              {!data.configured && (
                <span className="text-muted-foreground text-sm">
                  Save a key pair first.
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3">
            <ErrorAlert>{error.message}</ErrorAlert>
          </div>
        )}
      </div>

    </>
  );
}
