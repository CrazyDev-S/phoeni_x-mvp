import { NextResponse } from "next/server";

import { findExtensionPackage } from "@/lib/extension-package";

// Reads the filesystem at request time: the answer changes whenever the
// extension is rebuilt, so it must not be baked in at build time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether a packaged extension is available, for the sidebar button. */
export async function GET() {
  const pkg = await findExtensionPackage();
  if (!pkg) {
    return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    {
      available: true,
      fileName: pkg.fileName,
      bytes: pkg.bytes,
      builtAt: pkg.builtAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
