/**
 * Bandwidth usage domain types.
 */

export type BandwidthSummary = {
  today: number;
  thisMonth: number;
  allTime: number;
  byStream: { streamId: string; bytes: number }[];
  daily: { date: string; bytes: number }[];
};
