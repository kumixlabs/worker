import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createSource, updateSourceProbe } from "../../src/db/sources";
import { getStream, setStreamStatus } from "../../src/db/streams";
import { getTarget } from "../../src/db/targets";
import { createApiApp } from "../../src/http/app";
import { decryptSecretWithToken } from "../../src/lib/crypto";
import { writeSettings } from "../../src/runtime/config";
import { hasSqlite } from "../helpers";

let dataDir: string;
let app: ReturnType<typeof createApiApp>;
const headers = {
  Authorization: "Bearer test-token-123456",
  "Content-Type": "application/json",
};

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  resetDbForTests();
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
  app = createApiApp();
});

afterEach(() => {
  resetDbForTests();
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe.skipIf(!hasSqlite())("API CRUD integration", () => {
  it("creates source, target, stream and lists events", async () => {
    const sourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Source", url: "https://example.com/video.mp4" }),
      headers,
      method: "POST",
    });
    const sourceBody = await sourceResponse.json();

    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({ label: "YouTube", streamKey: "secret" }),
      headers,
      method: "POST",
    });
    const targetBody = await targetResponse.json();

    const streamResponse = await app.request("/api/streams", {
      body: JSON.stringify({
        sourceId: sourceBody.data.id,
        targetId: targetBody.data.id,
        title: "Live",
      }),
      headers,
      method: "POST",
    });
    const streamBody = await streamResponse.json();

    const eventsResponse = await app.request(`/api/streams/${streamBody.data.id}/events`, {
      headers,
    });
    const eventsBody = await eventsResponse.json();

    expect(sourceResponse.status).toBe(201);
    expect(targetResponse.status).toBe(201);
    expect(streamResponse.status).toBe(201);
    expect(streamBody.data.id).toMatch(/^stm_/);
    expect(eventsResponse.status).toBe(200);
    expect(Array.isArray(eventsBody.data)).toBe(true);
  });

  it("returns conflict when deleting referenced source or target", async () => {
    const sourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Source", url: "https://example.com/video.mp4" }),
      headers,
      method: "POST",
    });
    const sourceBody = await sourceResponse.json();
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({ label: "YouTube", streamKey: "secret" }),
      headers,
      method: "POST",
    });
    const targetBody = await targetResponse.json();
    await app.request("/api/streams", {
      body: JSON.stringify({
        sourceId: sourceBody.data.id,
        targetId: targetBody.data.id,
        title: "Live",
      }),
      headers,
      method: "POST",
    });

    const sourceDeleteResponse = await app.request(`/api/sources/${sourceBody.data.id}`, {
      headers,
      method: "DELETE",
    });
    const targetDeleteResponse = await app.request(`/api/targets/${targetBody.data.id}`, {
      headers,
      method: "DELETE",
    });

    expect(sourceDeleteResponse.status).toBe(409);
    expect(targetDeleteResponse.status).toBe(409);
  });

  it("supports bulk deletes and signed event URLs", async () => {
    const firstSourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Source A", url: "https://example.com/a.mp4" }),
      headers,
      method: "POST",
    });
    const firstSource = await firstSourceResponse.json();
    const secondSourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Source B", url: "https://example.com/b.mp4" }),
      headers,
      method: "POST",
    });
    const secondSource = await secondSourceResponse.json();
    const bulkResponse = await app.request("/api/sources", {
      body: JSON.stringify({ ids: [firstSource.data.id, secondSource.data.id] }),
      headers,
      method: "DELETE",
    });
    const bulkBody = await bulkResponse.json();
    const signedResponse = await app.request("/api/events/signed-url", {
      body: JSON.stringify({ path: "/api/events/export" }),
      headers,
      method: "POST",
    });
    const signedBody = await signedResponse.json();
    const signedExportResponse = await app.request(signedBody.data.url);
    const signedDeleteResponse = await app.request(signedBody.data.url, { method: "DELETE" });
    const invalidSignedResponse = await app.request("/api/events/signed-url", {
      body: JSON.stringify({ path: "/api/events" }),
      headers,
      method: "POST",
    });

    expect(bulkResponse.status).toBe(200);
    expect(bulkBody.data.deleted).toHaveLength(2);
    expect(bulkBody.data.failed).toHaveLength(0);
    expect(signedResponse.status).toBe(200);
    expect(signedBody.data.url).toContain("sig=");
    expect(signedBody.data.url).not.toContain("token=");
    expect(signedExportResponse.status).toBe(200);
    expect(signedDeleteResponse.status).toBe(401);
    expect(invalidSignedResponse.status).toBe(400);
  });

  it("serves a ready source preview only via a signed URL with range support", async () => {
    const filePath = path.join(dataDir, "preview-sample.mp4");
    writeFileSync(filePath, Buffer.from("0123456789", "utf8"));
    const source = createSource({ kind: "url", name: "Preview", url: "https://example.com/p.mp4" });
    updateSourceProbe(source.id, { status: "ready", filePath });

    const signedResponse = await app.request(`/api/sources/${source.id}/preview-url`, {
      headers,
      method: "POST",
    });
    const signedBody = await signedResponse.json();
    const unsignedResponse = await app.request(`/api/sources/${source.id}/preview`);
    const fullResponse = await app.request(signedBody.data.url);
    const fullBytes = await fullResponse.arrayBuffer();
    const rangeResponse = await app.request(signedBody.data.url, {
      headers: { range: "bytes=2-5" },
    });
    const rangeText = await rangeResponse.text();

    expect(signedResponse.status).toBe(200);
    expect(signedBody.data.url).toContain("/preview?");
    expect(signedBody.data.url).toContain("sig=");
    expect(signedBody.data.url).not.toContain("token=");
    expect(unsignedResponse.status).toBe(401);
    expect(fullResponse.status).toBe(200);
    expect(fullResponse.headers.get("accept-ranges")).toBe("bytes");
    expect(fullBytes.byteLength).toBe(10);
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(rangeText).toBe("2345");
  });

  it("refuses preview URLs for sources that are not ready", async () => {
    const sourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Pending", url: "https://example.com/x.mp4" }),
      headers,
      method: "POST",
    });
    const sourceBody = await sourceResponse.json();

    const signedResponse = await app.request(`/api/sources/${sourceBody.data.id}/preview-url`, {
      headers,
      method: "POST",
    });

    expect(signedResponse.status).toBe(404);
  });

  it("supports auth handoff, public stats, and token rotation", async () => {
    const authResponse = await app.request("/auth?token=test-token-123456");
    const authLocation = authResponse.headers.get("location") ?? "";
    const handoffCode = new URL(authLocation, "http://worker.local").searchParams.get("code") ?? "";
    const exchangeResponse = await app.request("/api/auth/exchange", {
      body: JSON.stringify({ code: handoffCode }),
      headers,
      method: "POST",
    });
    const exchangeBody = await exchangeResponse.json();
    const reuseExchangeResponse = await app.request("/api/auth/exchange", {
      body: JSON.stringify({ code: handoffCode }),
      headers,
      method: "POST",
    });
    const verifyResponse = await app.request("/api/auth/verify", {
      body: JSON.stringify({ token: "test-token-123456" }),
      headers,
      method: "POST",
    });
    const healthResponse = await app.request("/api/v1/health", { headers });
    const healthBody = await healthResponse.json();
    const statsResponse = await app.request("/api/v1/stats", { headers });
    const statsBody = await statsResponse.json();
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({ label: "YouTube", streamKey: "secret-before-rotation" }),
      headers,
      method: "POST",
    });
    const targetBody = await targetResponse.json();
    const beforeRotation = getTarget(targetBody.data.id)!;
    const sameTokenResponse = await app.request("/api/v1/settings/token", {
      body: JSON.stringify({ token: "test-token-123456" }),
      headers,
      method: "POST",
    });
    const rotateResponse = await app.request("/api/v1/settings/token", {
      body: JSON.stringify({ token: "new-token-123456789" }),
      headers,
      method: "POST",
    });
    const oldTokenResponse = await app.request("/api/v1/stats", { headers });
    const newTokenResponse = await app.request("/api/v1/stats", {
      headers: { Authorization: "Bearer new-token-123456789" },
    });

    expect(authResponse.status).toBe(302);
    expect(authLocation).toMatch(/^\/\?code=/);
    expect(authLocation).not.toContain("test-token-123456");
    expect(exchangeResponse.status).toBe(200);
    expect(exchangeBody.data.token).toBe("test-token-123456");
    expect(reuseExchangeResponse.status).toBe(401);
    expect(verifyResponse.status).toBe(200);
    expect(healthResponse.status).toBe(200);
    expect(["ok", "degraded"]).toContain(healthBody.data.status);
    expect(healthBody.data.streamsRunning).toBe(0);
    expect(statsResponse.status).toBe(200);
    expect(statsBody.data.system.agentVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof statsBody.data.system.health.ffmpeg).toBe("boolean");
    expect(statsBody.data.system.cpu.cores).toBeGreaterThan(0);
    expect(statsBody.data.system.disk.usedPercent).toBeGreaterThanOrEqual(0);
    expect(targetResponse.status).toBe(201);
    expect(decryptSecretWithToken(beforeRotation.streamKey, "test-token-123456")).toBe(
      "secret-before-rotation",
    );
    expect(sameTokenResponse.status).toBe(409);
    expect(rotateResponse.status).toBe(200);
    const afterRotation = getTarget(targetBody.data.id)!;
    expect(afterRotation.streamKey).not.toBe(beforeRotation.streamKey);
    expect(decryptSecretWithToken(afterRotation.streamKey, "new-token-123456789")).toBe(
      "secret-before-rotation",
    );
    expect(decryptSecretWithToken(afterRotation.streamKey, "test-token-123456")).toBe("");
    expect(oldTokenResponse.status).toBe(401);
    expect(newTokenResponse.status).toBe(200);
  });

  it("never leaks the ciphered stream key and masks the plaintext preview", async () => {
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({ label: "YouTube", streamKey: "super-secret-key" }),
      headers,
      method: "POST",
    });
    const created = await targetResponse.json();
    const readResponse = await app.request(`/api/targets/${created.data.id}`, { headers });
    const readBody = await readResponse.json();

    expect(created.data.streamKey).toBeUndefined();
    expect(readBody.data.streamKey).toBeUndefined();
    expect(readBody.data.streamKeyMasked).toBeDefined();
    expect(readBody.data.streamKeyMasked).not.toContain("super-secret-key");
    expect(readBody.data.streamKeyMasked).not.toContain("enc:v1");
  });

  it("refuses to delete a running stream and keeps it intact", async () => {
    const sourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Source", url: "https://example.com/video.mp4" }),
      headers,
      method: "POST",
    });
    const sourceBody = await sourceResponse.json();
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({ label: "YouTube", streamKey: "secret" }),
      headers,
      method: "POST",
    });
    const targetBody = await targetResponse.json();
    const streamResponse = await app.request("/api/streams", {
      body: JSON.stringify({
        sourceId: sourceBody.data.id,
        targetId: targetBody.data.id,
        title: "Live",
      }),
      headers,
      method: "POST",
    });
    const streamBody = await streamResponse.json();
    setStreamStatus(streamBody.data.id, "running", { pid: 123456 });

    const singleDeleteResponse = await app.request(`/api/streams/${streamBody.data.id}`, {
      headers,
      method: "DELETE",
    });
    const bulkDeleteResponse = await app.request("/api/streams", {
      body: JSON.stringify({ ids: [streamBody.data.id] }),
      headers,
      method: "DELETE",
    });
    const bulkBody = await bulkDeleteResponse.json();

    expect(singleDeleteResponse.status).toBe(409);
    expect(bulkBody.data.deleted).toHaveLength(0);
    expect(bulkBody.data.failed).toHaveLength(1);
    expect(getStream(streamBody.data.id)?.status).toBe("running");
  });
});
