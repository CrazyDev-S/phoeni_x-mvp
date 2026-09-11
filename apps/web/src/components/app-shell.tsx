"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { tokens } from "@/lib/api";

const NAV = [
  { href: "/resumes", label: "Resumes" },
  { href: "/tailor", label: "Tailor" },
  { href: "/applications", label: "Applications" },
  { href: "/calendar", label: "Calendar" },
  { href: "/maintenance", label: "Maintenance" },
  { href: "/settings", label: "Settings" },
];

const PUBLIC = ["/login", "/register"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Guard on the client: tokens live in web storage, not a cookie, so the
    // server cannot know whether this request is authenticated.
    if (!isPublic && !tokens.access() && !tokens.refresh()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [isPublic, pathname, router]);

  if (isPublic) return <main className="min-h-screen">{children}</main>;
  if (!ready) return <div className="min-h-screen" aria-busy />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/resumes" className="font-semibold tracking-tight">
            Resume<span className="text-[var(--color-brand)]">Assist</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]"
                      : "text-[var(--color-ink-soft)] hover:bg-[var(--color-canvas)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => {
              tokens.clear();
              router.replace("/login");
            }}
            className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
