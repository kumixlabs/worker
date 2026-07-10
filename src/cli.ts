#!/usr/bin/env node

/**
 * Command-line interface for initializing, serving, inspecting, and updating Forge Worker.
 */

import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Command } from "commander";

import { cliHelpText } from "./cli-help";
import { listStreams } from "./db/streams";
import { reencryptTargetSecrets } from "./db/targets";
import { createApiApp } from "./http/app";
import { readPackageVersion } from "./lib/version";
import {
  ensureDataDir,
  readSettings,
  resetWorkerData,
  validToken,
  writeSettings,
} from "./runtime/config";
import { resolveFfmpegBinaries } from "./runtime/ffmpeg";
import { runtimeHealthDetails, runtimeMetrics } from "./runtime/metrics";
import { consumeAutoStartMarker, recoverInterruptedStreams } from "./runtime/recovery";
import { startScheduler } from "./runtime/scheduler";
import {
  activeStreamIds,
  latestVersion,
  performSelfUpdate,
  type RestartMode,
} from "./runtime/update";
import { startStream, stopAllStreams } from "./services/stream-runner";

/**
 * Masks a token for safe display in CLI output.
 *
 * @param token - The raw token.
 * @returns A masked preview of the token.
 */
export function maskToken(token: string): string {
  return token.length <= 10 ? "••••" : `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/**
 * Formats a byte count as gigabytes with two decimals.
 *
 * @param bytes - The byte count.
 * @returns The value in GB as a fixed-2 string.
 */
function formatGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

/**
 * Parses and validates a TCP port option.
 *
 * @param value - The raw CLI value.
 * @param label - The option label used in error output.
 * @returns The validated port number.
 */
function parsePort(value: string, label = "port"): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${label}: ${value}. Expected integer 1-65535.`);
  }
  return port;
}

/**
 * Parses and validates the disk usage limit percentage.
 *
 * @param value - The raw CLI value.
 * @returns The validated percentage.
 */
function parseDiskLimit(value: string): number {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < 50 || percent > 99) {
    throw new Error(`Invalid disk limit: ${value}. Expected integer 50-99.`);
  }
  return percent;
}

/**
 * Validates a timezone option against Intl support and schema bounds.
 *
 * @param value - The raw CLI value.
 * @returns The validated timezone string.
 */
function parseTimezone(value: string): string {
  if (value.length < 1 || value.length > 64) {
    throw new Error("Invalid timezone. Expected 1-64 characters.");
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new Error(`Invalid timezone: ${value}. Expected a valid IANA timezone.`);
  }
  return value;
}

function parseToken(value: string): string {
  return validToken(value);
}

export function dashboardUrl(host: string, port: number, token?: string): string {
  const dashboardHost = host === "0.0.0.0" ? "localhost" : host;
  const base = `http://${dashboardHost}:${port}`;
  return token ? `${base}/auth?token=${encodeURIComponent(token)}` : base;
}

/**
 * Prints an error and exits the CLI.
 *
 * @param error - The failure value to print.
 */
function exitWithError(error: unknown): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

/**
 * Returns platform-appropriate restart guidance.
 *
 * @returns A short restart instruction.
 */
function restartHint(): string {
  return process.platform === "win32"
    ? "Restart the forge-worker terminal or Windows service to apply the new version."
    : "Restart the forge-worker service/process to apply the new version.";
}

/**
 * Starts streams requested by an update auto-start marker when their stop window has not elapsed.
 *
 * @param streamIds - Stream IDs requested for auto-start.
 * @returns Auto-start result counts.
 */
async function autoStartStreams(
  streamIds: string[],
): Promise<{ started: number; skipped: number }> {
  let started = 0;
  let skipped = 0;
  const now = Date.now();
  for (const streamId of streamIds) {
    const stream = listStreams().find((item) => item.id === streamId);
    if (!stream || (stream.autoStopAt && new Date(stream.autoStopAt).getTime() <= now)) {
      skipped += 1;
      continue;
    }
    try {
      const result = await startStream(streamId);
      if (result) started += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { started, skipped };
}

/**
 * Builds the Forge Worker CLI program with init, serve, and status commands.
 *
 * @returns The configured commander program.
 */
export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("forge-worker")
    .description("Forge Worker self-hosted live runner")
    .version(readPackageVersion(), "-v, --version", "Print the installed Forge Worker version")
    .helpOption("-h, --help", "Show all commands and usage information")
    .addHelpText("after", cliHelpText);

  // No subcommand: show a short hint instead of exiting silently.
  program.action(() => {
    console.log("Forge Worker - self-hosted live runner");
    console.log("");
    console.log("No command provided. Run 'forge-worker --help' to see all commands.");
  });

  program
    .command("init")
    .description("Create or update the local Forge Worker config")
    .option("--token <token>", "dashboard/API token")
    .option("--port <port>", "local HTTP port")
    .option("--host <host>", "host used only for printed dashboard URLs", "localhost")
    .option("--timezone <timezone>", "IANA timezone for recurring schedules")
    .option("--disk-limit <percent>", "reject new sources past this disk usage percent")
    .option("--dev", "development mode: keep/generate local token and print full URLs")
    .option("--show", "print the full token instead of a masked preview")
    .action(
      (opts: {
        token?: string;
        port?: string;
        host: string;
        timezone?: string;
        diskLimit?: string;
        dev?: boolean;
        show?: boolean;
      }) => {
        try {
          const current = readSettings();
          const nextToken = opts.token ? parseToken(opts.token) : current.token;
          const next = {
            ...current,
            token: nextToken,
            port: opts.port ? parsePort(opts.port) : current.port,
            timezone: opts.timezone ? parseTimezone(opts.timezone) : current.timezone,
            diskUsageLimitPercent: opts.diskLimit
              ? parseDiskLimit(opts.diskLimit)
              : current.diskUsageLimitPercent,
          };
          if (nextToken !== current.token) reencryptTargetSecrets(current.token, nextToken);
          writeSettings(next);
          const showSecret = Boolean(opts.show || opts.dev);
          console.log(`Forge Worker config written to ${ensureDataDir()}`);
          console.log(`Token: ${showSecret ? next.token : maskToken(next.token)}`);
          console.log(`Port: ${next.port}`);
          console.log(`Timezone: ${next.timezone}`);
          console.log(`Disk usage limit: ${next.diskUsageLimitPercent}%`);
          console.log(`Dashboard: ${dashboardUrl(opts.host, next.port)}`);
          console.log(
            `Auth URL: ${showSecret ? dashboardUrl(opts.host, next.port, next.token) : "hidden (use --dev or --show)"}`,
          );
        } catch (error) {
          exitWithError(error);
        }
      },
    );

  program
    .command("serve")
    .description("Run local Forge Worker API")
    .option("--host <host>", "host", "localhost")
    .option("--port <port>", "port override")
    .option("--dev", "development mode (prints the full token)")
    .action(async (opts: { host: string; port?: string; dev?: boolean }) => {
      const settings = readSettings();
      let port: number;
      try {
        port = opts.port ? parsePort(opts.port) : settings.port;
      } catch (error) {
        exitWithError(error);
      }

      // Preflight: fail fast with a clear message when binaries are missing.
      try {
        resolveFfmpegBinaries();
      } catch (error) {
        console.error(error instanceof Error ? error.message : "FFmpeg binaries unavailable");
        process.exit(1);
      }

      const autoStartIds = consumeAutoStartMarker();

      // Crash recovery: reconcile streams left running by a previous process.
      const recovered = recoverInterruptedStreams(autoStartIds);

      const app = createApiApp();
      const server = serve({
        fetch: app.fetch,
        hostname: opts.host,
        port,
      });
      const stopScheduler = startScheduler();
      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        stopScheduler();
        await stopAllStreams();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        process.exit(0);
      };
      process.once("SIGINT", () => void shutdown());
      process.once("SIGTERM", () => void shutdown());

      console.log(`Forge Worker API listening on http://${opts.host}:${port}`);
      console.log(`Dashboard: ${dashboardUrl(opts.host, port)}`);
      if (opts.host === "0.0.0.0") {
        console.log("Warning: API is exposed on the network. Keep the worker token secret.");
      }
      console.log(`Data directory: ${ensureDataDir()}`);
      console.log(`Timezone: ${settings.timezone}`);
      console.log(`Disk usage limit: ${settings.diskUsageLimitPercent}%`);
      if (recovered.length > 0) {
        console.log(`Recovered ${recovered.length} interrupted stream(s) as failed`);
      }
      if (autoStartIds.length > 0) {
        const autoStarted = await autoStartStreams(autoStartIds);
        console.log(
          `Auto-started ${autoStarted.started} stream(s); skipped ${autoStarted.skipped} stream(s).`,
        );
      }
      console.log(
        opts.dev
          ? `Token: ${settings.token}`
          : `Token: ${maskToken(settings.token)} (use --dev to print full token)`,
      );
      if (opts.dev) console.log(`Auth URL: ${dashboardUrl(opts.host, port, settings.token)}`);
    });

  program
    .command("status")
    .description("Print local Forge Worker status, binary health, and disk usage")
    .action(() => {
      const settings = readSettings();
      const health = runtimeHealthDetails();
      const metrics = runtimeMetrics();
      const disk = metrics.storage.disk;

      console.log("Config:");
      console.log(`  Token: ${maskToken(settings.token)}`);
      console.log(`  Port: ${settings.port}`);
      console.log(`  Timezone: ${settings.timezone}`);
      console.log(`  Disk usage limit: ${settings.diskUsageLimitPercent}%`);
      console.log(`  Data directory: ${settings.dataDir}`);

      console.log("Binaries:");
      console.log(`  FFmpeg: ${health.ffmpeg.version ?? "unknown"} (${health.ffmpeg.path})`);
      console.log(`  FFprobe: ${health.ffprobe.version ?? "unknown"} (${health.ffprobe.path})`);

      console.log("Disk:");
      if (disk) {
        console.log(`  Used: ${formatGb(disk.usedBytes)} / ${formatGb(disk.totalBytes)} GB`);
        console.log(`  Free: ${formatGb(disk.freeBytes)} GB`);
        console.log(`  Usage: ${disk.usedPercent}%`);
      } else {
        console.log("  Unavailable");
      }
      console.log(`  Cache: ${formatGb(metrics.storage.cacheBytes)} GB`);
    });

  program
    .command("doctor")
    .description("Run preflight checks for FFmpeg/FFprobe, config, and disk usage")
    .action(() => {
      let ok = true;
      const settings = readSettings();

      try {
        const health = runtimeHealthDetails();
        console.log(`[ok] FFmpeg: ${health.ffmpeg.version ?? "available"}`);
        console.log(`[ok] FFprobe: ${health.ffprobe.version ?? "available"}`);
      } catch (error) {
        ok = false;
        console.error(`[fail] ${error instanceof Error ? error.message : "FFmpeg unavailable"}`);
      }

      console.log(`[ok] Config readable at ${settings.dataDir}`);
      console.log(
        settings.token.length >= 12
          ? "[ok] Token present"
          : "[warn] Token looks too short; run 'forge-worker token --regenerate'",
      );

      const disk = runtimeMetrics().storage.disk;
      if (disk) {
        const overLimit = disk.usedPercent >= settings.diskUsageLimitPercent;
        console.log(
          overLimit
            ? `[warn] Disk usage ${disk.usedPercent}% is at/over the ${settings.diskUsageLimitPercent}% limit`
            : `[ok] Disk usage ${disk.usedPercent}% (limit ${settings.diskUsageLimitPercent}%)`,
        );
      } else {
        console.log("[warn] Disk usage unavailable");
      }

      console.log(ok ? "Doctor: all critical checks passed" : "Doctor: critical checks failed");
      if (!ok) process.exit(1);
    });

  program
    .command("token")
    .description("Print or rotate the local Forge Worker token")
    .option("--regenerate", "generate and store a new token")
    .option("--show", "print the full token instead of a masked preview")
    .action((opts: { regenerate?: boolean; show?: boolean }) => {
      const current = readSettings();
      if (opts.regenerate) {
        const token = randomBytes(32).toString("base64url");
        reencryptTargetSecrets(current.token, token);
        writeSettings({ ...current, token });
        console.log("New token generated.");
        console.log(`Token: ${opts.show ? token : maskToken(token)}`);
        return;
      }
      console.log(`Token: ${opts.show ? current.token : maskToken(current.token)}`);
    });

  program
    .command("update")
    .description("Update the @tubeforge/worker package via npm")
    .option("--check", "only check for a newer version, do not install")
    .option("--restart", "restart the service after install when no streams are active")
    .option("--force", "restart even when streams are active")
    .option("--auto-start", "start previously active streams after forced restart")
    .action(
      async (opts: {
        check?: boolean;
        restart?: boolean;
        force?: boolean;
        autoStart?: boolean;
      }) => {
        const current = readPackageVersion();

        if (opts.check) {
          const latest = await latestVersion();
          if (!latest) {
            console.error("Could not reach the npm registry to check for updates.");
            process.exit(1);
          }
          console.log(
            latest === current
              ? `Already up to date (v${current})`
              : `Update available: v${current} -> v${latest}`,
          );
          return;
        }

        if (opts.autoStart && !opts.force) {
          console.error(
            "--auto-start requires --force because normal updates skip restart with active streams.",
          );
          process.exit(1);
        }
        const restartMode: RestartMode = opts.force ? "force" : opts.restart ? "auto" : "never";

        console.log(`Updating @tubeforge/worker (current v${current})...`);
        try {
          const result = await performSelfUpdate({
            autoStart: Boolean(opts.autoStart),
            currentVersion: current,
            restartMode,
          });
          if (result.installed) {
            console.log(
              result.latestVersion
                ? `Installed @tubeforge/worker@${result.latestVersion}`
                : "Installed @tubeforge/worker@latest",
            );
          } else if (result.latestVersion === current) {
            console.log(`Already up to date (v${current})`);
          }
          if (result.restarted) {
            console.log("Service restarted.");
          } else if (result.restartSkippedReason) {
            console.log(`Restart skipped: ${result.restartSkippedReason}`);
            console.log(restartHint());
          }
        } catch (error) {
          console.error(error instanceof Error ? error.message : "Update failed");
          process.exit(1);
        }
      },
    );

  program
    .command("reset")
    .description("Clear worker data (database, cache, tombstones)")
    .option("--all", "factory reset: also delete the token and config")
    .option("--yes", "confirm the destructive operation")
    .option("--force", "delete data even if active streams are detected")
    .action(async (opts: { all?: boolean; yes?: boolean; force?: boolean }) => {
      if (!opts.yes) {
        console.error("This is a destructive operation that stops all streams and deletes data.");
        console.error("Run again with --yes to confirm.");
        if (opts.all) console.error("Warning: --all will permanently delete your worker token.");
        process.exit(1);
      }

      const externalActive = activeStreamIds().length;
      if (externalActive > 0 && !opts.force) {
        console.error(
          `${externalActive} active stream(s) detected in database or tombstones. Stop the worker service first, or rerun with --force.`,
        );
        process.exit(1);
      }

      console.log("Stopping active streams...");
      const stopResult = await stopAllStreams();
      if (stopResult.remaining.length > 0 && !opts.force) {
        console.error(
          `Timed out waiting for ${stopResult.remaining.length} stream(s) to stop. Rerun with --force to delete data anyway.`,
        );
        process.exit(1);
      }
      if (stopResult.requested.length > 0) {
        console.log(
          `Stop requested for ${stopResult.requested.length} stream(s); ${stopResult.remaining.length} still tracked.`,
        );
      }

      console.log(`Deleting worker data... ${opts.all ? "(factory reset)" : "(keeping config)"}`);
      resetWorkerData(Boolean(opts.all));

      console.log(`Reset complete. Data directory: ${ensureDataDir()}`);
      if (opts.all) {
        console.log("Config deleted. Run 'forge-worker init' to configure a new token.");
      }
    });

  return program;
}

const invokedPath = process.argv[1] ? realpathSync.native(process.argv[1]) : null;
const modulePath = realpathSync.native(fileURLToPath(import.meta.url));

if (invokedPath === modulePath) {
  createCliProgram().parse(process.argv);
}
