#!/usr/bin/env node

/**
 * Command-line interface for serving, inspecting, and managing Kumix Worker.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Command } from "commander";

import { closeAuthDb, getAuth, getAuthDb } from "./auth/server";
import { closeDb } from "./db/client";
import { listStreams } from "./db/streams";
import { createApiApp } from "./http/app";
import { readPackageVersion } from "./lib/version";
import { ensureDataDir, readSettings, resetWorkerData } from "./runtime/config";
import { resolveFfmpegBinaries } from "./runtime/ffmpeg";
import { runtimeHealthDetails, runtimeMetrics } from "./runtime/metrics";
import {
  consumeAutoStartMarker,
  recoverInterruptedStreams,
  writeAutoStartMarker,
} from "./runtime/recovery";
import { startScheduler } from "./runtime/scheduler";
import {
  activeStreamIds,
  latestVersion,
  performSelfUpdate,
  type RestartMode,
} from "./runtime/update";
import { startStream, stopAllStreams } from "./services/stream-runner";

function autoResumeEnabled(): boolean {
  const raw = process.env.KUMIX_WORKER_AUTO_RESUME?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

function gigabytes(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name("kumix-worker")
    .description("Multi-user live stream worker with local dashboard and API")
    .version(readPackageVersion());

  program
    .command("init")
    .description("Initialize the worker data directory and configuration")
    .action(() => {
      ensureDataDir();
      const settings = readSettings();
      console.log(`Kumix Worker initialized at ${settings.dataDir}`);
      console.log(`Port: ${settings.port}`);
      console.log(`Timezone: ${settings.timezone}`);
    });

  program
    .command("serve")
    .description("Start the Kumix Worker HTTP server and stream scheduler")
    .option("-p, --port <port>", "Port to bind to")
    .option("-H, --host <host>", "Host to bind to")
    .action(async (options) => {
      ensureDataDir();
      const settings = readSettings();
      const port = options.port ? Number(options.port) : settings.port;
      const hostname = options.host ?? "localhost";

      recoverInterruptedStreams();
      const app = createApiApp();
      startScheduler();

      const server = serve({ fetch: app.fetch, port, hostname }, () => {
        console.log(`Kumix Worker running on http://${hostname}:${port}`);
      });

      const autoResume = autoResumeEnabled();
      if (autoResume) {
        const toResume = consumeAutoStartMarker();
        if (toResume.length > 0) {
          console.log(`[worker] Auto-resuming ${toResume.length} stream(s) from previous run...`);
          for (const id of toResume) {
            startStream(id).catch((err) => {
              console.error(
                `[worker] Auto-resume failed for stream ${id}:`,
                err instanceof Error ? err.message : err,
              );
            });
          }
        }
      }

      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\nReceived ${signal}, shutting down...`);

        if (autoResume) {
          const active = activeStreamIds();
          if (active.length > 0) writeAutoStartMarker(active);
        }

        try {
          await stopAllStreams();
        } catch (error) {
          console.error("[worker] Error stopping streams during shutdown:", error);
        }

        server.close(() => {
          closeDb();
          closeAuthDb();
          process.exit(0);
        });

        setTimeout(() => {
          console.error("[worker] Forcefully terminating after timeout");
          closeDb();
          closeAuthDb();
          process.exit(1);
        }, 5000).unref();
      };

      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
    });

  program
    .command("status")
    .description("Display the current state and health of the worker")
    .action(async () => {
      const settings = readSettings();
      const health = runtimeHealthDetails();
      const metrics = await runtimeMetrics();
      const streams = listStreams();
      const userCount = (
        getAuthDb().prepare("SELECT COUNT(*) AS n FROM user").get() as { n: number }
      ).n;

      console.log(`Kumix Worker v${readPackageVersion()}`);
      console.log(`Data Directory: ${settings.dataDir}`);
      console.log(`Port: ${settings.port}`);
      console.log(`Timezone: ${settings.timezone}`);
      console.log(`Users: ${userCount}`);
      console.log(`Streams: ${streams.length} total`);
      console.log(`FFmpeg: ${health.ffmpeg.available ? "Ready" : "Missing"}`);
      console.log(`FFprobe: ${health.ffprobe.available ? "Ready" : "Missing"}`);
      if (metrics.storage?.disk) {
        console.log(
          `Disk: ${gigabytes(metrics.storage.disk.usedBytes)}GB / ${gigabytes(metrics.storage.disk.totalBytes)}GB (${metrics.storage.disk.usedPercent}%)`,
        );
      }
    });

  program
    .command("doctor")
    .description("Diagnose common issues and check dependencies")
    .action(async () => {
      console.log("Running diagnostics for Kumix Worker...");
      const binaries = resolveFfmpegBinaries();
      console.log(`FFmpeg: ${binaries.ffmpegPath ?? "NOT FOUND"}`);
      console.log(`FFprobe: ${binaries.ffprobePath ?? "NOT FOUND"}`);
      const settings = readSettings();
      console.log(`Data directory: ${settings.dataDir}`);
      console.log(`Config file: OK`);
      const userCount = (
        getAuthDb().prepare("SELECT COUNT(*) AS n FROM user").get() as { n: number }
      ).n;
      console.log(`Admin accounts initialized: ${userCount > 0 ? "Yes" : "No (visit / to setup)"}`);
    });

  program
    .command("admin")
    .description("Create or reset an admin account from the CLI")
    .requiredOption("-e, --email <email>", "Admin email address")
    .requiredOption("-p, --password <password>", "Admin password (min 8 chars)")
    .option("-n, --name <name>", "Admin name", "Admin")
    .action(async (options) => {
      const email = options.email.trim();
      const password = options.password;
      const name = options.name.trim();

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        console.error("Error: A valid email address is required.");
        process.exit(1);
      }
      if (password.length < 8) {
        console.error("Error: Password must be at least 8 characters.");
        process.exit(1);
      }

      const existing = getAuthDb().prepare("SELECT id FROM user WHERE email = ?").get(email) as
        | {
            id: string;
          }
        | undefined;

      if (existing) {
        const res = await getAuth().api.setUserPassword({
          body: { userId: existing.id, newPassword: password },
        });
        if (res && "error" in res && res.error) {
          console.error(
            `Error: ${(res.error as { message?: string }).message ?? "could not set password"}`,
          );
          process.exit(1);
        }
        getAuthDb().prepare("UPDATE user SET role = 'admin' WHERE id = ?").run(existing.id);
        console.log(`Updated admin password for ${email}.`);
      } else {
        const res = await getAuth().api.signUpEmail({
          body: { email, password, name, callbackURL: "/" },
        });
        if (res && "error" in res && res.error) {
          console.error(
            `Error: ${(res.error as { message?: string }).message ?? "could not create account"}`,
          );
          process.exit(1);
        }
        getAuthDb().prepare("UPDATE user SET role = 'admin' WHERE email = ?").run(email);
        console.log(`Created admin account for ${email}.`);
      }
    });

  program
    .command("update")
    .description("Check for and apply self-updates to the worker package")
    .option("--check", "Only check if an update is available without applying it")
    .option("-y, --yes", "Skip confirmation prompt and apply the update immediately")
    .option("--restart <mode>", "How to restart after update (pm2|systemd|none)", "none")
    .action(async (options) => {
      const current = readPackageVersion();
      console.log(`Current version: ${current}`);
      const latest = await latestVersion();
      if (!latest) {
        console.error("Could not fetch latest version from npm.");
        process.exit(1);
      }
      console.log(`Latest version:  ${latest}`);
      if (current === latest) {
        console.log("Kumix Worker is up to date.");
        return;
      }
      if (options.check) return;
      console.log(`Updating to ${latest}...`);
      await performSelfUpdate({
        currentVersion: current,
        restartMode: options.restart as RestartMode,
        autoStart: autoResumeEnabled(),
      });
      console.log(`Updated successfully to ${latest}.`);
    });

  program
    .command("reset")
    .description("Delete database and cache (factory reset)")
    .option("--all", "Also delete config.json")
    .option("-y, --yes", "Skip confirmation")
    .action((options) => {
      if (!options.yes) {
        console.error("Pass --yes to confirm destructive reset.");
        process.exit(1);
      }
      resetWorkerData(Boolean(options.all));
      console.log("Worker data reset complete.");
    });

  return program;
}

const isDirectCli = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
};

if (isDirectCli()) {
  buildCli().parse(process.argv);
}
