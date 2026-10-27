"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import Image from "next/image";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      router.replace("/");
    } catch {
      setError(`Cannot reach the API at ${API_URL}. Is the backend running?`);
    } finally {
      setBusy(false);
    }
  }

  function switchTo(next: "login" | "register") {
    setMode(next);
    setError(null);
  }

  const heading = mode === "login" ? "Sign in" : "Create account";

  return (
    <div className="bg-background grid min-h-svh place-items-center p-4">
      <section className="page-enter bg-card w-full max-w-[360px] rounded-lg border p-5">
        <Image
          src="/phoenix-mark.png"
          alt="PhoeniX"
          width={512}
          height={512}
          priority
          className="mx-auto size-14 object-contain"
        />
        <h1 className="mt-2 text-center text-lg font-semibold">{heading}</h1>

        <Tabs value={mode} onValueChange={(next) => switchTo(next as "login" | "register")} className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>
        </Tabs>

        <form onSubmit={submit} className="mt-4">
          <FieldGroup className="gap-3">
            <FormField label="Email">
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Password" hint={mode === "register" ? "At least 10 characters." : undefined}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  required
                  minLength={mode === "register" ? 10 : undefined}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </FormField>
            {error && <ErrorAlert>{error}</ErrorAlert>}
            <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy}>
              {busy && <Spinner />}
              {heading}
            </Button>
          </FieldGroup>
        </form>
      </section>
    </div>
  );
}
