import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Resume Assist",
  description: "Tailor, track and follow through on every application.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes writes the class on <html> before paint, which React cannot
    // know about while hydrating - so the mismatch on this one element is
    // expected rather than a bug.
    <html lang="en" suppressHydrationWarning className={cn(sans.variable, mono.variable)}>
      <body className="font-sans antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
