#!/usr/bin/env node

/**
 * Rewrites extensionless relative imports in TypeScript's Node-compatible ESM output.
 * Node.js requires `.js` extensions for relative ESM imports at runtime.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

const SKIP_DIRS = new Set(["node_modules", "public"]);
const TARGET_EXT = ".js";

const RELATIVE_FROM = /from\s+(['"])(\.\.?\/[^'"]+)\1/g;
const DYNAMIC_IMPORT = /import\s*\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;

function needsJsExtension(specifier) {
  if (extname(specifier)) return false;
  return true;
}

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith(TARGET_EXT)) {
      files.push(full);
    }
  }
  return files;
}

function rewrite(content) {
  let changed = false;
  const update = (_match, quote, spec) => {
    if (!needsJsExtension(spec)) return _match;
    changed = true;
    return `from ${quote}${spec}.js${quote}`;
  };
  const updateDyn = (_match, quote, spec) => {
    if (!needsJsExtension(spec)) return _match;
    changed = true;
    return `import(${quote}${spec}.js${quote})`;
  };
  const next = content.replace(RELATIVE_FROM, update).replace(DYNAMIC_IMPORT, updateDyn);
  return { next, changed };
}

async function processFile(file) {
  const original = await readFile(file, "utf8");
  const { next, changed } = rewrite(original);
  if (changed) {
    await writeFile(file, next, "utf8");
    const rel = file.slice(DIST.length + 1);
    console.log(`  + ${rel}`);
    return 1;
  }
  return 0;
}

async function main() {
  console.log("[fix-esm-ext] rewriting relative imports under dist/");
  const files = await walk(DIST);
  let updated = 0;
  for (const file of files) {
    updated += await processFile(file);
  }
  console.log(
    `[fix-esm-ext] done. ${updated} file(s) updated, ${files.length - updated} unchanged.`,
  );
}

main().catch((err) => {
  console.error("[fix-esm-ext] failed:", err);
  process.exit(1);
});
