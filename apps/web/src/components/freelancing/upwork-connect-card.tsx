"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, KeyRound, Link2, Plug, RefreshCw, Unplug } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    queryFn: () => request<UpworkConnection>("/api/v1/freelancing/upwork/connection"),
    staleTime: 30_000,
  });
}

/**
 * The Upwork link, in Settings.
 *
 * Two steps: an API key pair from upwork.com/developer/keys, then the OAuth
 * round trip. The redirect URI to register is shown because the two have to
 * match to the character, and a mismatch fails silently on Upwork's side.
 */
export function UpworkConnectCard({ notice }: { notice?: { kind: "connected" | "error"; reason?: string } | null }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useUpworkConnection();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY });

  const saveCredentials = useMutation({
    mutationFn: () =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/credentials", {
        method: "PUT",
        body: JSON.stringify({ client_id: clientId.trim(), client_secret: clientSecret.trim() }),
      }),
    onSuccess: (row) => {
      queryClient.setQueryData(CONNECTION_QUERY, row);
      setClientId("");
      setClientSecret("");
    },
  });

  const removeCredentials = useMutation({
    mutationFn: () =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/credentials", { method: "DELETE" }),
    onSuccess: (row) => queryClient.setQueryData(CONNECTION_QUERY, row),
  });

  const authorize = useMutation({
    mutationFn: () => request<{ url: string }>("/api/v1/freelancing/upwork/authorize", { method: "POST" }),
    // A full navigation: Upwork's sign-in page cannot be opened in a fetch.
    onSuccess: ({ url }) => window.location.assign(url),
  });

  const disconnect = useMutation({
    mutationFn: () =>
      request<UpworkConnection>("/api/v1/freelancing/upwork/disconnect", { method: "POST" }),
    onSuccess: (row) => {
      queryClient.setQueryData(CONNECTION_QUERY, row);
      setTest(null);
    },
  });

  const runTest = useMutation({
    mutationFn: () => request<TestResult>("/api/v1/freelancing/upwork/test", { method: "POST" }),
    onSuccess: (result) => {
      setTest(result);
      refresh();
    },
    onError: (error) => setTest({ ok: false, detail: (error as Error).message, upwork_user_name: null, organizations: [] }),
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
      <Card>
        <CardHeader>
          <CardTitle>Upwork</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const status = CONNECTION_LABEL[data.status];
  const error = (saveCredentials.error ?? authorize.error ?? disconnect.error ?? removeCredentials.error) as
    | Error
    | null;
  const organizations = test?.organizations ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Upwork</CardTitle>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {data.credentials_source === "environment" && (
            <StatusBadge tone="neutral">Key pair from the server</StatusBadge>
          )}
        </div>
        <CardDescription>
          Job search runs against Upwork&rsquo;s API on your behalf. Create an API key at{" "}
          <a
            href="https://www.upwork.com/developer/keys"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            upwork.com/developer/keys
            <ExternalLink className="size-3" />
          </a>{" "}
          with the &ldquo;Read marketplace Job Postings&rdquo; permission, then authorize it here.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
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

        {/* Step 1: the redirect URI, and the key pair. */}
        <div className="space-y-3">
          <p className="text-sm font-medium">1. Register the redirect URI on the key</p>
          <div className="flex items-center gap-2">
            <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2.5 py-2 font-mono text-xs">
              {data.redirect_uri}
            </code>
            <Button
              size="sm"
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
          <p className="text-subtle text-xs">
            It must match exactly. Set API_PUBLIC_URL on the backend if this is not the address your
            browser reaches it at.
          </p>
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-sm font-medium">2. API key pair</p>
          {data.configured && data.credentials_source === "user" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
              <KeyRound className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {data.client_id} · {data.masked_client_secret}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={removeCredentials.isPending}
                onClick={() => removeCredentials.mutate()}
              >
                Replace
              </Button>
            </div>
          ) : data.configured ? (
            <p className="text-muted-foreground text-sm">
              A key pair is set on the server ({data.client_id}). Add your own below to use it instead.
            </p>
          ) : null}
          {(!data.configured || data.credentials_source !== "user") && (
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Client ID" className="min-w-48 flex-1">
                {(control) => (
                  <Input {...control} value={clientId} onChange={(e) => setClientId(e.target.value)} />
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
                disabled={clientId.trim().length < 8 || clientSecret.trim().length < 8 || saveCredentials.isPending}
                onClick={() => saveCredentials.mutate()}
              >
                {saveCredentials.isPending && <Spinner />}
                Save key pair
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {/* Step 3: authorize, or the connected account. */}
        <div className="space-y-3">
          <p className="text-sm font-medium">3. Authorize</p>
          {data.connected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
                <Link2 className="text-success size-4 shrink-0" />
                <span className="min-w-0 flex-1 text-sm">
                  Connected as <strong>{data.upwork_user_name ?? "your Upwork account"}</strong>
                  {data.connected_at && (
                    <span className="text-subtle"> · since {formatDateTime(data.connected_at, "d MMM")}</span>
                  )}
                </span>
                <Button size="sm" variant="outline" disabled={runTest.isPending} onClick={() => runTest.mutate()}>
                  {runTest.isPending ? <Spinner /> : <RefreshCw />}
                  Test
                </Button>
                <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  <Unplug />
                  Disconnect
                </Button>
              </div>
              {test && (
                <p className={test.ok ? "text-success text-sm" : "text-destructive text-sm"}>
                  {test.detail}
                </p>
              )}
              {organizations.length > 1 && (
                <FormField
                  label="Organization"
                  hint="Which Upwork organization the API acts for. Usually your freelancer profile."
                >
                  {(control) => (
                    <Select
                      value={data.tenant_id ?? ""}
                      onValueChange={(value) => setTenant.mutate(value || null)}
                    >
                      <SelectTrigger {...control} className="w-full sm:w-80">
                        <SelectValue placeholder="Default organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.organization_id} value={org.organization_id}>
                            {org.title}
                            {org.type_title ? ` · ${org.type_title}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
              <p className="text-subtle text-xs">
                Access tokens last 24 hours and are refreshed automatically. A session unused for two
                weeks expires and has to be authorized again.
              </p>
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
                <span className="text-muted-foreground text-sm">Save a key pair first.</span>
              )}
            </div>
          )}
        </div>

        {error && <ErrorAlert>{error.message}</ErrorAlert>}

        <p className="text-subtle text-xs">
          Upwork&rsquo;s terms allow a posting to be cached for 24 hours. Search results you have not
          focused are dropped after a day; focused jobs stay because they are your own list.{" "}
          <Link href="/freelancing/jobs" className="text-primary hover:underline">
            Go to jobs
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
