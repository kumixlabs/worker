/**
 * Target domain types.
 * A target is a streaming destination (ingest URL + encrypted stream key).
 */

/**
 * Represents a streaming destination.
 * The raw streamKey is stored encrypted in the database and never exposed.
 */
export interface TargetRecord {
  id: string;
  label: string;
  ingestUrl: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
