/**
 * Public package entry point for Kumix Worker runtime consumers.
 */

export { buildCli } from "./cli";
export { readPackageVersion } from "./lib/version";
export type { SettingsPatchInput } from "./schemas/settings";
export { settingsPatchSchema } from "./schemas/settings";
export type { EventRecord } from "./types/event";
export type {
  PublicSettings,
  WorkerMetrics,
  WorkerSettings,
  WorkerStats,
} from "./types/worker";

/** Standard success envelope returned by worker API routes. */
export type ApiSuccess<T> = { ok: true; data: T };
/** Standard error envelope returned by worker API routes. */
export type ApiError = { ok: false; error: { code?: string; message: string } };
/** Union of the success and error worker API envelopes. */
export type ApiEnvelope<T> = ApiSuccess<T> | ApiError;
