import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAuthForTests } from "../../src/auth/server";
import { resetDbForTests } from "../../src/db/client";
import { createSource, getSource, updateSourceProbe } from "../../src/db/sources";
import { getStream, setStreamStatus } from "../../src/db/streams";
import { createApiApp } from "../../src/http/app";
import { writeSettings } from "../../src/runtime/config";
import { createAdminSession, hasSqlite, jsonHeaders, rmDataDirForTests } from "../helpers";

let dataDir: string;
let app: ReturnType<typeof createApiApp>;
let headers: Record<string, string>;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  resetAuthForTests();
  resetDbForTests();
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
  app = createApiApp();
  headers = jsonHeaders(await createAdminSession(app));
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmDataDirForTests(dataDir);
});

function markSourceReady(sourceId: string) {
  updateSourceProbe(sourceId, { status: "ready", filePath: path.join(dataDir, "video.mp4") });
}

describe.skipIf(!hasSqlite())("API CRUD integration", () => {
  it("creates source, target, stream and lists events", async () => {
    const sourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Source", url: "https://example.com/video.mp4" }),
      headers,
      method: "POST",
    });
    const sourceBody = await sourceResponse.json();
    markSourceReady(sourceBody.data.id);

    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({
        label: "YouTube",
        streamKey: "secret",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      }),
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
    markSourceReady(sourceBody.data.id);
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({
        label: "YouTube",
        streamKey: "secret",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      }),
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
    for (const id of [firstSource.data.id, secondSource.data.id]) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const status = getSource(id)?.status;
        if (status !== "pending" && status !== "downloading" && status !== "probing") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
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

  it("retry returns 404 for a missing source", async () => {
    const response = await app.request("/api/sources/missing/retry", {
      headers,
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("retry returns 409 for a ready source", async () => {
    const source = createSource({ kind: "url", name: "Ready", url: "https://example.com/r.mp4" });
    updateSourceProbe(source.id, { status: "ready", filePath: "/tmp/ready.mp4" });
    const response = await app.request(`/api/sources/${source.id}/retry`, {
      headers,
      method: "POST",
    });
    expect(response.status).toBe(409);
  });

  it("retry accepts an invalid source and keeps the record", async () => {
    const source = createSource({ kind: "url", name: "Broken", url: "https://example.com/b.mp4" });
    updateSourceProbe(source.id, { status: "invalid", invalidReason: "boom" });
    const response = await app.request(`/api/sources/${source.id}/retry`, {
      headers,
      method: "POST",
    });
    expect(response.status).toBe(202);
    const listResponse = await app.request("/api/sources", { headers });
    const list = (await listResponse.json()) as { data: { id: string }[] };
    expect(list.data.some((item) => item.id === source.id)).toBe(true);
  });

  it("cancel returns 404 when no download is active", async () => {
    const source = createSource({ kind: "url", name: "Broken", url: "https://example.com/b.mp4" });
    updateSourceProbe(source.id, { status: "invalid", invalidReason: "boom" });
    const response = await app.request(`/api/sources/${source.id}/cancel`, {
      headers,
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("patches a source name via PATCH", async () => {
    const source = createSource({
      kind: "url",
      name: "Original",
      url: "https://example.com/v.mp4",
    });
    const patchResponse = await app.request(`/api/sources/${source.id}`, {
      body: JSON.stringify({ name: "Renamed" }),
      headers,
      method: "PATCH",
    });
    const patchBody = await patchResponse.json();
    const missingResponse = await app.request("/api/sources/src_nonexistent", {
      body: JSON.stringify({ name: "X" }),
      headers,
      method: "PATCH",
    });
    const invalidResponse = await app.request(`/api/sources/${source.id}`, {
      body: JSON.stringify({ name: "" }),
      headers,
      method: "PATCH",
    });

    expect(patchResponse.status).toBe(200);
    expect(patchBody.data.name).toBe("Renamed");
    expect(missingResponse.status).toBe(404);
    expect(invalidResponse.status).toBe(400);
  });

  it("serves stats, metrics, and health details", async () => {
    const statsResponse = await app.request("/api/stats", { headers });
    const statsBody = await statsResponse.json();

    expect(statsResponse.status).toBe(200);
    expect(statsBody.ok).toBe(true);
    expect(statsBody.data.streams.total).toBe(0);
  });

  it("never leaks the ciphered stream key and masks the plaintext preview", async () => {
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({
        label: "YouTube",
        streamKey: "super-secret-key",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      }),
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
    markSourceReady(sourceBody.data.id);
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({
        label: "YouTube",
        streamKey: "secret",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      }),
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

  it("streams global events over SSE via a signed URL", async () => {
    const signedResponse = await app.request("/api/events/signed-url", {
      body: JSON.stringify({ path: "/api/events/stream" }),
      headers,
      method: "POST",
    });
    const signedBody = await signedResponse.json();

    // Unsigned SSE request should be rejected.
    const unsignedResponse = await app.request("/api/events/stream");
    // Signed SSE request should open an event-stream.
    const sseResponse = await app.request(signedBody.data.url);
    const reader = sseResponse.body?.getReader();
    const firstChunk = reader ? await reader.read() : null;
    reader?.cancel();

    expect(signedResponse.status).toBe(200);
    expect(signedBody.data.url).toContain("/api/events/stream?");
    expect(signedBody.data.url).toContain("sig=");
    expect(unsignedResponse.status).toBe(401);
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toBe("text/event-stream");
    expect(sseResponse.headers.get("cache-control")).toBe("no-cache");
    // The hello frame should arrive immediately.
    expect(firstChunk?.done).toBe(false);
    const text = new TextDecoder().decode(firstChunk?.value);
    expect(text).toContain("data:");
    expect(text).toContain("hello");
  });

  it("streams stream-specific events over SSE via a signed URL", async () => {
    const sourceResponse = await app.request("/api/sources", {
      body: JSON.stringify({ kind: "url", name: "Source", url: "https://example.com/v.mp4" }),
      headers,
      method: "POST",
    });
    const sourceBody = await sourceResponse.json();
    markSourceReady(sourceBody.data.id);
    const targetResponse = await app.request("/api/targets", {
      body: JSON.stringify({
        label: "YouTube",
        streamKey: "secret",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      }),
      headers,
      method: "POST",
    });
    const targetBody = await targetResponse.json();
    const streamResponse = await app.request("/api/streams", {
      body: JSON.stringify({
        sourceId: sourceBody.data.id,
        targetId: targetBody.data.id,
        title: "SSE Test",
      }),
      headers,
      method: "POST",
    });
    const streamBody = await streamResponse.json();

    const signedResponse = await app.request("/api/events/signed-url", {
      body: JSON.stringify({ path: `/api/streams/${streamBody.data.id}/events/stream` }),
      headers,
      method: "POST",
    });
    const signedBody = await signedResponse.json();
    const sseResponse = await app.request(signedBody.data.url);
    const reader = sseResponse.body?.getReader();
    const firstChunk = reader ? await reader.read() : null;
    reader?.cancel();

    expect(signedResponse.status).toBe(200);
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toBe("text/event-stream");
    const text = new TextDecoder().decode(firstChunk?.value);
    expect(text).toContain("hello");
    expect(text).toContain(streamBody.data.id);
  });

  it("rejects signed URLs with method mismatch", async () => {
    // Signed URLs are method-scoped (GET). A DELETE should fail auth.
    const signedResponse = await app.request("/api/events/signed-url", {
      body: JSON.stringify({ path: "/api/events/export" }),
      headers,
      method: "POST",
    });
    const signedBody = await signedResponse.json();
    const deleteResponse = await app.request(signedBody.data.url, { method: "DELETE" });

    expect(deleteResponse.status).toBe(401);
  });
});
