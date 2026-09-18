import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { findExtensionPackage } from "@/lib/extension-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams the packaged extension as a .zip attachment. */
export async function GET() {
  const pkg = await findExtensionPackage();
  if (!pkg) {
    return NextResponse.json(
      {
        error: "The extension has not been packaged yet.",
        hint: "Run `npm run zip:ext` from the repository root, then try again.",
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Streamed rather than buffered: the file is small today, but nothing here
  // needs it held in memory.
  const stream = Readable.toWeb(createReadStream(pkg.filePath)) as ReadableStream<Uint8Array>;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(pkg.bytes),
      "Content-Disposition": `attachment; filename="${pkg.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
