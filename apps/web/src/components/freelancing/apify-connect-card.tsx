"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { SOURCE_QUERY } from "@/components/freelancing/job-source";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { request } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { ApifyConnection } from "@/lib/freelancing";

const CONNECTION_QUERY = ["freelancing", "apify", "connection"];

interface TestResult {
  ok: boolean;
  detail: string;
  apify_username: string | null;
  plan: string | null;
  actor_title: string | null;
  price_per_job_usd: number | null;
}

const STATUS: Record<ApifyConnection["status"], { label: string; tone: Tone }> = {
  unverified: { label: "Not tested", tone: "neutral" },
  valid: { label: "Working", tone: "ok" },
  invalid: { label: "Rejected", tone: "bad" },
  revoked: { label: "Revoked", tone: "bad" },
};

/**
 * The Apify token, in Settings.
 *
 * Job search runs the Apify "Upwork Job Scraper" actor, which reads Upwork's
 * public search pages; no Upwork account or API key is involved. Every run is
 * billed to the Apify account behind this token, per job returned.
 */
export function ApifyConnectCard() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: CONNECTION_QUERY,
    queryFn: () => request<ApifyConnection>("/api/v1/freelancing/apify/connection"),
  });

  const refresh = (row: ApifyConnection) => {
    queryClient.setQueryData(CONNECTION_QUERY, row);
    queryClient.invalidateQueries({ queryKey: SOURCE_QUERY });
  };

  const save = useMutation({
    mutationFn: () =>
      request<ApifyConnection>("/api/v1/freelancing/apify/token", {
        method: "PUT",
        body: JSON.stringify({ token: token.trim() }),
      }),
    onSuccess: (row) => {
      refresh(row);
      setToken("");
      setTest(null);
      runTest.mutate();
    },
  });

  const remove = useMutation({
    mutationFn: () => request<ApifyConnection>("/api/v1/freelancing/apify/token", { method: "DELETE" }),
    onSuccess: (row) => {
      refresh(row);
      setTest(null);
    },
  });

  const runTest = useMutation({
    mutationFn: () => request<TestResult>("/api/v1/freelancing/apify/test", { method: "POST" }),
    onSuccess: (result) => {
      setTest(result);
      queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY });
      queryClient.invalidateQueries({ queryKey: SOURCE_QUERY });
    },
    onError: (error) =>
      setTest({ ok: false, detail: (error as Error).message, apify_username: null, plan: null, actor_title: null, price_per_job_usd: null }),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Apify</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const status = data.configured ? STATUS[data.status] : { label: "Not configured", tone: "neutral" as Tone };
  const error = (save.error ?? remove.error) as Error | null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Apify</CardTitle>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {data.token_source === "environment" && <StatusBadge tone="neutral">Token from the server</StatusBadge>}
        </div>
        <CardDescription>
          Job search runs the{" "}
          <a
            href={`https://apify.com/${data.actor_id.replace("~", "/")}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            {data.actor_id.replace("~", "/")}
            <ExternalLink className="size-3" />
          </a>{" "}
          actor on Apify. No Upwork account or API key is needed. Paste an API token from{" "}
          <a
            href="https://console.apify.com/settings/integrations"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            Apify Console → Settings → Integrations
            <ExternalLink className="size-3" />
          </a>
          .
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {data.configured && data.token_source === "user" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
            <KeyRound className="text-muted-foreground size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{data.masked_token}</span>
            {data.apify_username && <span className="text-muted-foreground text-xs">{data.apify_username}</span>}
            <Button size="sm" variant="outline" disabled={runTest.isPending} onClick={() => runTest.mutate()}>
              {runTest.isPending ? <Spinner /> : <RefreshCw />}
              Test
            </Button>
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()} aria-label="Remove the token">
              <Trash2 />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {data.token_source === "environment" && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
                <KeyRound className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{data.masked_token}</span>
                <Button size="sm" variant="outline" disabled={runTest.isPending} onClick={() => runTest.mutate()}>
                  {runTest.isPending ? <Spinner /> : <RefreshCw />}
                  Test
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <FormField
                label={data.token_source === "environment" ? "Use your own token instead" : "API token"}
                className="min-w-56 flex-1"
              >
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    placeholder="apify_api_…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                )}
              </FormField>
              <Button disabled={token.trim().length < 10 || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Spinner />}
                Save and test
              </Button>
            </div>
          </div>
        )}

        {test && (
          <div className={test.ok ? "text-success space-y-1 text-sm" : "text-destructive text-sm"}>
            <p className="flex items-center gap-1.5">
              {test.ok && <Check className="size-4" />}
              {test.detail}
              {test.plan ? ` · ${test.plan} plan` : ""}
            </p>
            {test.ok && test.actor_title && (
              <p className="text-muted-foreground text-xs">
                {test.actor_title} is reachable
                {test.price_per_job_usd != null ? ` · about $${test.price_per_job_usd.toFixed(4)} per job returned` : ""}.
              </p>
            )}
          </div>
        )}
        {!test && data.last_error && <ErrorAlert>{data.last_error}</ErrorAlert>}
        {error && <ErrorAlert>{error.message}</ErrorAlert>}

        <Separator />

        <dl className="text-muted-foreground grid gap-1.5 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-subtle inline">Actor </dt>
            <dd className="inline font-mono">{data.actor_id}</dd>
          </div>
          <div>
            <dt className="text-subtle inline">Last run </dt>
            <dd className="inline">
              {data.last_run_at ? `${formatDateTime(data.last_run_at, "d MMM, HH:mm")} · ${data.last_run_id}` : "none yet"}
            </dd>
          </div>
        </dl>
        <p className="text-subtle text-xs leading-relaxed">
          Each search starts one actor run on this Apify account. {data.cost_note} Test shows the
          current price per job. Loading more results reads what a run already returned before
          starting another, and repeating a search within half an hour reuses its run.
        </p>
      </CardContent>
    </Card>
  );
}
