/**
 * Package self-update and optional systemd restart helpers.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { listStreams } from "../db/streams";
import { readSettings } from "./config";
import { listTombstones, writeAutoStartMarker } from "./recovery";

const execFileAsync = promisify(execFile);

const NPM_PACKAGE = "@kumix/worker";
const SERVICE_NAME = "kumix-worker";

/**
 * How aggressively the updater is allowed to restart the systemd service.
 * - "auto": restart only when no active streams are detected.
 * - "force": restart even when streams are running.
 * - "never": install only, never restart.
 */
export type RestartMode = "auto" | "force" | "never";

/**
 * Outcome of a self-update attempt.
 */
export interface SelfUpdateResult {
  currentVersion: string;
  latestVersion: string | null;
  installed: boolean;
  restarted: boolean;
  restartSkippedReason: string | null;
}

/**
 * Runs a command and returns trimmed stdout.
 *
 * @param command - The executable to run.
 * @param args - Arguments passed to the executable.
 * @returns The trimmed stdout output.
 */
async function run(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    const err = error as { message?: string; stderr?: string; stdout?: string };
    const details = [err.message, err.stderr?.trim(), err.stdout?.trim()]
      .filter(Boolean)
      .join("\n");
    throw new Error(details || `${command} ${args.join(" ")} failed`);
  }
}

/**
 * Resolves the npm binary name for the current platform.
 *
 * @returns "npm.cmd" on Windows, otherwise "npm".
 */
function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compares two semver-like version strings.
 * Falls back to lexical comparison when either value is not `x.y.z`.
 *
 * @param a - Left version.
 * @param b - Right version.
 * @returns Positive when `a` is newer, negative when `b` is newer, or zero when equal.
 */
function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return a.localeCompare(b);
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index] - right[index];
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Waits for the local worker health endpoint to become healthy after a restart.
 *
 * @param port - Worker HTTP port.
 * @param timeoutMs - Maximum time to wait in milliseconds.
 */
async function waitForHealth(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(lastError instanceof Error ? lastError.message : "worker health check timed out");
}

/**
 * Reads the latest published version of the worker package from the npm registry.
 *
 * @returns The latest version string, or null when it cannot be resolved.
 */
export async function latestVersion(): Promise<string | null> {
  try {
    return await run(npmCommand(), ["view", NPM_PACKAGE, "version"]);
  } catch {
    return null;
  }
}

/**
 * Installs the latest worker package globally via npm.
 */
async function installLatest(): Promise<void> {
  await run(npmCommand(), ["install", "-g", `${NPM_PACKAGE}@latest`]);
}

/**
 * Lists streams that appear active from DB rows or crash-recovery tombstones.
 *
 * @returns Active stream IDs.
 */
export function activeStreamIds(): string[] {
  const activeIds = new Set<string>();
  for (const stream of listStreams().filter(
    (item) => item.status === "running" || item.status === "stopping",
  )) {
    activeIds.add(stream.id);
  }
  for (const tombstone of listTombstones()) activeIds.add(tombstone.streamId);
  return Array.from(activeIds);
}

/**
 * Checks whether the kumix-worker systemd service is currently active.
 * Always false on non-Linux platforms.
 *
 * @returns True when the service reports "active".
 */
async function systemdServiceActive(): Promise<boolean> {
  if (process.platform !== "linux") return false;
  try {
    const status = await run("systemctl", ["is-active", SERVICE_NAME]);
    return status === "active";
  } catch {
    return false;
  }
}

/**
 * Restarts the kumix-worker systemd service.
 */
async function restartSystemdService(): Promise<void> {
  await run("systemctl", ["restart", SERVICE_NAME]);
}

/**
 * Installs the latest worker package and conditionally restarts the service.
 * Restart is skipped when streams are active unless restartMode is "force".
 *
 * @param args - The current version and the desired restart behavior.
 * @returns A summary of what was installed and whether a restart occurred.
 */
export async function performSelfUpdate(args: {
  currentVersion: string;
  restartMode: RestartMode;
  autoStart: boolean;
}): Promise<SelfUpdateResult> {
  const latest = await latestVersion();
  const result: SelfUpdateResult = {
    currentVersion: args.currentVersion,
    latestVersion: latest,
    installed: false,
    restarted: false,
    restartSkippedReason: null,
  };

  if (latest && compareVersions(latest, args.currentVersion) <= 0) {
    result.restartSkippedReason =
      latest === args.currentVersion
        ? "already up to date"
        : "registry version is older than current version";
    return result;
  }

  await installLatest();
  result.installed = true;

  if (args.restartMode === "never") {
    result.restartSkippedReason = "restart not requested (use --restart or --force)";
    return result;
  }

  const active = await systemdServiceActive();
  if (!active) {
    result.restartSkippedReason = "systemd service is not active";
    return result;
  }

  const activeStreams = activeStreamIds();
  if (activeStreams.length > 0 && args.restartMode !== "force") {
    result.restartSkippedReason = `${activeStreams.length} active stream(s) detected`;
    return result;
  }
  if (activeStreams.length > 0 && args.autoStart) {
    writeAutoStartMarker(activeStreams);
  }

  await restartSystemdService();
  await waitForHealth(readSettings().port);
  result.restarted = true;
  return result;
}
