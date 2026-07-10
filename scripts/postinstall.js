#!/usr/bin/env node

/**
 * Postinstall script to ensure Forge Worker public assets exist
 * This runs after package installation to handle edge cases where
 * the public directory is not extracted properly
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, "..");
const distDir = path.join(packageRoot, "dist");
const publicInDist = path.join(distDir, "public");
const publicInRoot = path.join(packageRoot, "public");

const hasPublicInDist =
  fs.existsSync(publicInDist) && fs.existsSync(path.join(publicInDist, "index.html"));
const hasPublicInRoot =
  fs.existsSync(publicInRoot) && fs.existsSync(path.join(publicInRoot, "index.html"));

if (hasPublicInDist || hasPublicInRoot) {
  if (hasPublicInRoot && !hasPublicInDist) {
    try {
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }
      copyRecursive(publicInRoot, publicInDist);
    } catch (err) {
      console.warn("[forge-worker] Warning: Could not copy to dist/public:", err.message);
    }
  } else if (hasPublicInDist && !hasPublicInRoot) {
    try {
      copyRecursive(publicInDist, publicInRoot);
    } catch (err) {
      console.warn("[forge-worker] Warning: Could not copy to public:", err.message);
    }
  }
} else {
  console.warn(
    "[forge-worker] Warning: Public directory not found. Forge Worker may not work correctly.",
  );
}

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
