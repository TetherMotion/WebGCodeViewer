/**
 * @file GcodeMetadata.ts
 * @brief Shared formatting helpers still used by the viewer UI.
 *
 * G-code metadata parsing now lives on the server; this module is kept
 * only for the lightweight `formatTime` utility used across panels.
 */

/**
 * Format time in seconds to a human-readable string.
 */
export function formatTime(seconds: number): string {
  if (seconds < 0 || !isFinite(seconds)) return '0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m ${secs}s`;
}
