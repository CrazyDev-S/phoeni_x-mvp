import type { Metadata } from "next";
import { Arimo, Caladea, Carlito, Geist_Mono, Inter } from "next/font/google";

import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { PALETTE_SCRIPT } from "@/lib/palettes";
import { PORTAL_SCRIPT } from "@/lib/portals";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

// Latin only: globals.css backs both with the system's emoji, symbol and math
// faces, so emoji and Unicode "fonts" (𝗯𝗼𝗹𝗱, 𝘪𝘵𝘢𝘭𝘪𝘤, 𝒮𝒸𝓇𝒾𝓅𝓉) render everywhere.
const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
// Metric-compatible with Calibri, the .docx font, so the resume preview breaks
// lines where Word does on machines without Calibri. Only the preview uses it.
const carlito = Carlito({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-carlito",
  preload: false,
});

// The other two faces the resume templates use, again as metric twins of what
// Word has: Arimo for Arial, Caladea for Cambria.
const arimo = Arimo({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-arimo",
  preload: false,
});
const caladea = Caladea({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-caladea",
  preload: false,
});

export const metadata: Metadata = {
  title: "PhoeniX",
  description: "Find work, tailor resumes, and follow through on every opportunity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes writes the class, PORTAL_SCRIPT the data-portal attribute and
    // PALETTE_SCRIPT the data-theme attribute on <html> before paint, which
    // React cannot know about while hydrating - so the mismatch on this one
    // element is expected rather than a bug.
    <html lang="en" suppressHydrationWarning className={cn(sans.variable, mono.variable, carlito.variable, arimo.variable, caladea.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_SCRIPT + PORTAL_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
