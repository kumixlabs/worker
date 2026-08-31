/**
 * Public package entry point for Kumix Worker runtime consumers.
 */

export { buildCli } from "./cli";
export { readPackageVersion } from "./lib/version";
export type { SettingsPatchInput } from "./schemas/settings";
export { settingsPatchSchema } from "./schemas/settings";
export type { SourceCreateInput, SourcePatchInput } from "./schemas/source";
export {
  sourceCreateSchema,
  sourceKindSchema,
  sourcePatchSchema,
  sourceStatusSchema,
} from "./schemas/source";
export type { StreamCreateInput, StreamPatchInput } from "./schemas/stream";
export {
  recurrenceSchema,
  streamCreateSchema,
  streamPatchSchema,
  streamStatusSchema,
} from "./schemas/stream";
export type { TargetCreateInput, TargetPatchInput } from "./schemas/target";
export { targetCreateSchema, targetPatchSchema } from "./schemas/target";
export type { EventRecord } from "./types/event";
export type { SourceKind, SourceRecord, SourceStatus } from "./types/source";
export type { StreamMetrics, StreamRecord, StreamRecurrence, StreamStatus } from "./types/stream";
export type { TargetRecord } from "./types/target";
export type {
  PublicSettings,
  WorkerHealthDetails,
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
