import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("frontend smoke", () => {
  it("uses signed event URLs instead of token query URLs", () => {
    const api = read("frontend/src/lib/api.ts");
    expect(api).not.toContain("?token=");
    expect(api).toContain("/api/events/signed-url");
  });

  it("sets page-specific browser titles through AppShell", () => {
    const shell = read("frontend/src/components/AppShell.tsx");
    expect(shell).toContain("document.title = `");
    expect(shell).toContain(" - Kumix Worker`");
  });

  it("supports paginated event loading", () => {
    const api = read("frontend/src/lib/api.ts");
    const log = read("frontend/src/routes/log.tsx");
    expect(api).toContain("before=");
    expect(log).toContain("loadOlderEvents");
  });

  it("uses starter Checkbox for selectable tables", () => {
    const table = read("frontend/src/components/DataTable.tsx");
    expect(table).toContain("Checkbox");
    expect(table).toContain("onCheckedChange");
  });
});
