"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { API_URL, tokens } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof body.detail === "string"
            ? body.detail
            : Array.isArray(body.detail)
              ? (body.detail[0]?.msg ?? "Check your details")
              : "Something went wrong",
        );
        return;
      }
      tokens.save(body.access_token, body.refresh_token);
      router.replace("/resumes");
    } catch {
      setError(`Cannot reach the API at ${API_URL}. Is the backend running?`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-background relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* A low ember glow behind the card: the one flourish on the way in. */}
      {/* Faded out by a radial mask rather than blurred: a blurred disc still
          shows its rim as a faint ring. */}
      <div
        aria-hidden
        className="bg-gradient-brand pointer-events-none absolute top-1/2 left-1/2 size-[44rem] -translate-x-1/2 -translate-y-1/2 opacity-20 [mask-image:radial-gradient(closest-side,black,transparent)] dark:opacity-25"
      />
      <div className="page-enter relative w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Brand size="x_lg" />
          <p className="text-muted-foreground max-w-sm text-sm text-balance">
            Tailor, track and follow through on every application.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {mode === "login" ? "Sign in" : "Create an account"}
            </CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Welcome back — pick up where you left off."
                : "It takes an email and a password. Nothing else."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form id="auth" onSubmit={submit}>
              <FieldGroup>
                <FormField label="Email">
                  {(control) => (
                    <Input
                      {...control}
                      type="email"
                      required
                      autoComplete="email"
                      className="h-11"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  )}
                </FormField>
                <FormField
                  label="Password"
                  hint={mode === "register" ? "At least 10 characters." : undefined}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="password"
                      required
                      minLength={mode === "register" ? 10 : undefined}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      className="h-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  )}
                </FormField>
                {error && <ErrorAlert>{error}</ErrorAlert>}
              </FieldGroup>
            </form>
          </CardContent>

          <CardFooter className="flex-col gap-3">
            <Button
              type="submit"
              form="auth"
              variant="brand"
              size="lg"
              className="h-11 w-full"
              disabled={busy}
            >
              {busy && <Spinner />}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
            >
              {mode === "login"
                ? "No account? Create one"
                : "Already have an account? Sign in"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
