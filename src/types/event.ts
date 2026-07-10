/**
 * Event domain types.
 * Events form an immutable audit log for streams and worker actions.
 */

/**
 * Represents an immutable log event for auditing stream lifecycles.
 */
export interface EventRecord {
  id: string;
  streamId: string | null;
  kind: string;
  message: string;
  payload: unknown | null;
  createdAt: string;
}
