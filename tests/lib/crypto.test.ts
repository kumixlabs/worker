import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, maskSecret } from "../../src/lib/crypto";
import { writeSettings } from "../../src/runtime/config";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
});

afterEach(() => {
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("Kumix Worker secret crypto", () => {
  it("encrypts and decrypts stream secrets", () => {
    const encrypted = encryptSecret("secret-stream-key");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("secret-stream-key");
    expect(decryptSecret(encrypted)).toBe("secret-stream-key");
  });

  it("returns an empty string for malformed ciphertext envelopes", () => {
    expect(decryptSecret("enc:v1:short:tag:ciphertext")).toBe("");
    expect(decryptSecret("enc:v1::::::::")).toBe("");
    expect(decryptSecret("plain-secret")).toBe("");
  });

  it("masks short and long secrets", () => {
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("abcd-efgh-ijkl")).toBe("abcd••••ijkl");
  });
});
