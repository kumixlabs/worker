/**
 * Package metadata helpers.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads the installed worker package version from nearby package.json files.
 *
 * @returns The package version, or 0.0.0 when unavailable.
 */
export function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../package.json"), join(here, "../../package.json")];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {}
  }
  return "0.0.0";
}
