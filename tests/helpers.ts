import { createRequire } from "node:module";

export function hasSqlite(): boolean {
  try {
    createRequire(import.meta.url)("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}
