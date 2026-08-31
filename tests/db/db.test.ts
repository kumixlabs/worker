import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { addEvent, clearEvents, listEvents, onEvent } from "../../src/db/events";
import { writeSettings } from "../../src/runtime/config";
import { hasSqlite } from "../helpers";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-db-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  resetDbForTests();
  writeSettings({
    signingSecret: "test-signing-secret",
    encryptionKey: "test-encryption-key",
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
});

afterEach(() => {
  resetDbForTests();
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe.skipIf(!hasSqlite())("DB integration", () => {
  it("stores events with payloads", () => {
    addEvent(null, "test", "Test event", { ok: true });
    const [event] = listEvents();

    expect(event?.id).toMatch(/^evt_/);
    expect(event?.payload).toEqual({ ok: true });
  });

  it("notifies listeners and clears events", () => {
    const received: string[] = [];
    const off = onEvent((event) => received.push(event.message));

    addEvent(null, "system", "First", null);
    off();
    addEvent(null, "system", "Second", null);

    expect(received).toEqual(["First"]);
    expect(listEvents()).toHaveLength(2);
    expect(clearEvents()).toBe(2);
    expect(listEvents()).toHaveLength(0);
  });

  it("persists falsy JSON event payloads", () => {
    addEvent(null, "system", "Zero", 0);
    addEvent(null, "system", "False", false);

    expect(listEvents().map((event) => event.payload)).toEqual([false, 0]);
  });
});
