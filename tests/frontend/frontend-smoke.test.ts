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

  it("uses DataGrid row selection for selectable tables", () => {
    const table = read("frontend/src/components/DataTable.tsx");
    expect(table).toContain("DataGridTableRowSelect");
    expect(table).toContain("DataGridTableRowSelectAll");
  });

  it("clears SSE reconnect timer on log page unmount", () => {
    const log = read("frontend/src/routes/log.tsx");
    expect(log).toContain("clearTimeout(reconnectTimer)");
    expect(log).toContain("clearInterval(flushTimer)");
    expect(log).toContain('event.type === "metrics"');
  });

  it("uses session auth and wall-clock worker timezone inputs", () => {
    const api = read("frontend/src/lib/api.ts");
    const authGate = read("frontend/src/components/AuthGate.tsx");
    const picker = read("frontend/src/components/DateTimePicker.tsx");
    expect(authGate).toContain("authClient.signIn.email");
    expect(api).toContain("kumix-worker-auth-invalid");
    expect(picker).toContain("toWallClockInput");
  });
});
