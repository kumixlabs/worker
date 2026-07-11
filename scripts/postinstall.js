#!/usr/bin/env node

/**
 * Postinstall script to ensure Kumix Worker public assets exist.
 * The published package ships dist/public (copied during `bun run build`).
 * For local dev without a build, the root public/ directory is also accepted.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, "..");
const distPublic = path.join(packageRoot, "dist", "public");
const rootPublic = path.join(packageRoot, "public");

const hasIndex = (dir) => fs.existsSync(dir) && fs.existsSync(path.join(dir, "index.html"));

if (hasIndex(distPublic)) {
  // Published package: dist/public is the source of truth.
  process.exit(0);
}

if (hasIndex(rootPublic)) {
  // Local dev without build: mirror root public/ into dist/public so the
  // worker can serve the dashboard from the expected location.
  try {
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    copyRecursive(rootPublic, distPublic);
  } catch (err) {
    console.warn("[kumix-worker] Warning: Could not copy public/ to dist/public:", err.message);
  }
  process.exit(0);
}

console.warn(
  "[kumix-worker] Warning: Public directory not found. Kumix Worker may not work correctly.",
);

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
