function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatBytesCompact(bytes: number | null): string {
  if (bytes == null) return "-";
  return formatBytes(bytes);
}

function formatDurationMs(milliseconds = 0) {
  if (!milliseconds) return "-";
  const seconds = milliseconds / 1000;
  return seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds)}s`;
}

function formatDurationClock(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

function formatMbps(value = 0) {
  return `${value.toFixed(value >= 10 ? 1 : 2)} Mbps`;
}

function formatUptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function percent(value = 0, total = 0) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function resolutionLabel(height: number) {
  if (height >= 2160) return "4K";
  if (height >= 1440) return "2K";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  return `${height}p`;
}

function formatBitrate(kbps: number) {
  return `${kbps} kbps / ${(kbps / 1000).toFixed(kbps % 1000 === 0 ? 0 : 1)} Mbps`;
}

export {
  formatBitrate,
  formatBytes,
  formatBytesCompact,
  formatDurationClock,
  formatDurationMs,
  formatMbps,
  formatUptime,
  percent,
  resolutionLabel,
};
