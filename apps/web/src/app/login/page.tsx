"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import Image from "next/image";

import { LoginShowcase } from "@/components/auth/login-showcase";
import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { API_URL, tokens } from "@/lib/api";
import { cn } from "@/lib/utils";

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
    <div className="bg-background min-h-svh p-4 sm:p-6">
      <div className="page-enter mx-auto grid min-h-[calc(100svh-2rem)] max-w-[1560px] gap-6 sm:min-h-[calc(100svh-3rem)] lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <section className="bg-card shadow-card mx-auto flex w-full max-w-xl flex-col rounded-[44px] px-7 py-10 sm:px-12 lg:mx-0 lg:max-w-none lg:px-16 lg:py-14">
          <Image
            src="/phoenix-mark.png"
            alt="PhoeniX"
            width={512}
            height={512}
            priority
            className="-mt-2 -ml-5 size-[120px] object-contain"
          />
          <h1 className="page-title isolate mt-8 max-sm:text-4xl max-sm:whitespace-normal">
            <span className="title-o">{heading[0]}</span>
            {heading.slice(1)}
          </h1>
          <p className="text-muted-foreground mt-3 text-base font-medium">
            {mode === "login"
              ? "Welcome back — pick up where you left off."
              : "It takes an email and a password. Nothing else."}
          </p>

          <div
            role="tablist"
            aria-label="Sign in or create an account"
            className="bg-soft mt-9 flex gap-0.5 rounded-full p-[5px]"
          >
            {(
              [
                ["login", "Sign in"],
                ["register", "Create account"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => switchTo(value)}
                className={cn(
                  "focus-visible:ring-ring/40 h-11 flex-1 rounded-full text-[0.9rem] font-semibold transition-colors outline-none focus-visible:ring-3",
                  mode === value
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-8">
            <FieldGroup className="gap-6">
              <FormField label="Email">
                {(control) => (
                  <div className="relative">
                    <Mail
                      aria-hidden
                      className="text-foreground pointer-events-none absolute top-1/2 left-5 size-[18px] -translate-y-1/2"
                    />
                    <Input
                      {...control}
                      type="email"
                      required
                      autoComplete="email"
                      className="h-16 rounded-[20px] pl-[3.25rem] text-base"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                )}
              </FormField>
              <FormField
                label="Password"
                hint={
                  mode === "register" ? "At least 10 characters." : undefined
                }
              >
                {(control) => (
                  <div className="relative">
                    <LockKeyhole
                      aria-hidden
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-5 size-[18px] -translate-y-1/2"
                    />
                    <Input
                      {...control}
                      type="password"
                      required
                      minLength={mode === "register" ? 10 : undefined}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      className="h-16 rounded-[20px] pl-[3.25rem] text-base"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                )}
              </FormField>
              {error && <ErrorAlert>{error}</ErrorAlert>}
              <Button
                type="submit"
                variant="brand"
                size="lg"
                className="mt-1.5 h-16 w-full text-base"
                disabled={busy}
              >
                {busy && <Spinner />}
                {heading}
                {!busy && <ArrowRight />}
              </Button>
            </FieldGroup>
          </form>

          <p className="text-muted-foreground mt-auto pt-10 text-center text-[0.9rem] font-semibold">
            {mode === "login" ? "No account? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => switchTo(mode === "login" ? "register" : "login")}
              className="text-foreground border-foreground focus-visible:ring-ring/40 border-b-[1.5px] font-bold outline-none focus-visible:ring-3"
            >
              {mode === "login" ? "Create one" : "Sign in"}
            </button>
          </p>
        </section>

        <LoginShowcase className="hidden lg:flex" />
      </div>
    </div>
  );
}
