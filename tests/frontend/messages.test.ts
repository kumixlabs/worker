import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "../../frontend/messages/en.json";
import id from "../../frontend/messages/id.json";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function usedMessageKeys() {
  const files = sourceFiles(join(process.cwd(), "frontend/src"));
  const used = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const namespaces = [...source.matchAll(/const\s+(\w+)\s*=\s*useTranslations\("([^"]+)"\)/g)];
    for (const [, fn, namespace] of namespaces) {
      used.add(namespace);
      const marker = `${fn}("`;
      let index = source.indexOf(marker);
      while (index !== -1) {
        const start = index + marker.length;
        const end = source.indexOf('"', start);
        if (end !== -1) used.add(`${namespace}.${source.slice(start, end)}`);
        index = source.indexOf(marker, start);
      }
      const templateMarker = `${fn}(`;
      let templateIndex = source.indexOf(`${templateMarker}\``);
      while (templateIndex !== -1) {
        const start = templateIndex + templateMarker.length + 1;
        const end = source.indexOf("`", start);
        if (end !== -1) {
          used.add(`${namespace}.${source.slice(start, end).replace(/\$\{[^}]+\}/g, "*")}`);
        }
        templateIndex = source.indexOf(`${templateMarker}\``, start);
      }
    }
  }
  return used;
}

function isUsed(key: string, used: Set<string>) {
  if (used.has(key)) return true;
  if (
    key.startsWith("Shell.navigation.") ||
    key.startsWith("Common.statuses.") ||
    key.startsWith("Common.eventKinds.")
  ) {
    return true;
  }
  return [...used].some(
    (pattern) =>
      pattern.includes("*") &&
      key.match(`^${pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+")}$`),
  );
}

describe("frontend messages", () => {
  it("keeps English and Indonesian message keys aligned", () => {
    expect(keys(id).sort()).toEqual(keys(en).sort());
  });

  it("does not keep orphan UI message keys", () => {
    const used = usedMessageKeys();
    const orphan = keys(en).filter((key) => !isUsed(key, used));
    expect(orphan).toEqual([]);
  });
});
