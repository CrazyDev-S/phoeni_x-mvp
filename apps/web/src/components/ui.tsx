"use client";

import type { ReactNode } from "react";

/** Small, boring primitives. One place to change the visual language. */

export function Card({
  children,
  className = "",
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-sm" }[size];
  const variants = {
    primary:
      "border-transparent bg-[var(--color-brand)] text-white hover:bg-[#16294a]",
    secondary:
      "border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-canvas)]",
    ghost: "border-transparent bg-transparent hover:bg-[var(--color-canvas)]",
    danger: "border-transparent bg-[var(--color-bad)] text-white hover:bg-[#991b1b]",
  }[variant];
  return (
    <button
      className={`${base} ${sizes} ${variants} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-ink-soft)]">
        {label}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1 block text-xs text-[var(--color-ink-soft)]">{hint}</span>
      )}
      {error && (
        <span className="mt-1 block text-xs text-[var(--color-bad)]">{error}</span>
      )}
    </label>
  );
}

const control =
  "w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand-soft)]";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${props.className ?? ""}`} />;
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad" | "brand";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-[var(--color-canvas)] text-[var(--color-ink-soft)]",
    ok: "bg-green-50 text-[var(--color-ok)]",
    warn: "bg-amber-50 text-[var(--color-warn)]",
    bad: "bg-red-50 text-[var(--color-bad)]",
    brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones}`}
    >
      {children}
    </span>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {body && (
        <p className="max-w-md text-sm text-[var(--color-ink-soft)]">{body}</p>
      )}
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-[var(--color-bad)]">
      {children}
    </p>
  );
}
