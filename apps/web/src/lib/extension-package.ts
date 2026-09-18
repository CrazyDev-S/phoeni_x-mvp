import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Where WXT leaves its build output.
 *
 * The portal serves the packaged extension rather than committing a binary to
 * the repo, so the download is always whatever `npm run zip:ext` last built.
 */
const OUTPUT_DIR = path.resolve(process.cwd(), "..", "extension", ".output");

export interface ExtensionPackage {
  filePath: string;
  fileName: string;
  bytes: number;
  builtAt: string;
}

/** The newest zip in the output directory, or null when none has been built. */
export async function findExtensionPackage(): Promise<ExtensionPackage | null> {
  let entries: string[];
  try {
    entries = await readdir(OUTPUT_DIR);
  } catch {
    return null;
  }

  const zips = entries.filter((name) => name.endsWith(".zip") && !name.includes("sources"));
  if (!zips.length) return null;

  const stats = await Promise.all(
    zips.map(async (name) => {
      const filePath = path.join(OUTPUT_DIR, name);
      const info = await stat(filePath);
      return { filePath, fileName: name, bytes: info.size, mtimeMs: info.mtimeMs };
    }),
  );

  const newest = stats.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return {
    filePath: newest.filePath,
    fileName: newest.fileName,
    bytes: newest.bytes,
    builtAt: new Date(newest.mtimeMs).toISOString(),
  };
}
