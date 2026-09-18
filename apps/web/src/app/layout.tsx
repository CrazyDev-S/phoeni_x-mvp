import type { Metadata } from "next";
import { Carlito, Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { PALETTE_SCRIPT } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
// Metric-compatible with Calibri, the .docx font, so the resume preview breaks
// lines where Word does on machines without Calibri. Only the preview uses it.
const carlito = Carlito({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-carlito",
  preload: false,
});

export const metadata: Metadata = {
  title: "Phoenix Eye",
  description: "Tailor, track and follow through on every application.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes writes the class, and PALETTE_SCRIPT the data-palette
    // attribute, on <html> before paint, which React cannot know about while
    // hydrating - so the mismatch on this one element is expected rather than
    // a bug.
    <html lang="en" suppressHydrationWarning className={cn(sans.variable, mono.variable, carlito.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
