"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { API_URL, tokens } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

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
    <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full p-6">
        <h1 className="text-lg font-semibold">
          {mode === "login" ? "Sign in" : "Create an account"}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          Tailor, track and follow through on every application.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email">
            <Input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field
            label="Password"
            hint={mode === "register" ? "At least 10 characters." : undefined}
          >
            <Input
              type="password"
              required
              minLength={mode === "register" ? 10 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="mt-4 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
        >
          {mode === "login"
            ? "No account? Create one"
            : "Already have an account? Sign in"}
        </button>
      </Card>
    </div>
  );
}
