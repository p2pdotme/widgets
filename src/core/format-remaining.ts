// Compact remaining-time formatter for action button labels and inline
// status hints. Optimised for narrow buttons — no plurals, no words. The
// output always fits in roughly 6 characters at the m/h boundaries and
// roughly 7 at d/h.
//
//   < 60s        →  "<n>s"      (e.g. "42s")
//   < 60m        →  "<n>m"      (e.g. "12m")
//   < 24h        →  "<h>h <m>m" (e.g. "4h 23m")
//   ≥ 24h        →  "<d>d <h>h" (e.g. "2d 4h")
//
// Negative or zero input clamps to "0s" so the formatter never returns an
// empty or negative-looking string when a state machine slips one tick
// past its window. Callers should still gate the *render* on a positive
// remaining; this is defence in depth.

export function formatRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "0s";
  const totalSeconds = Math.floor(remainingMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes - totalHours * 60;
  if (totalHours < 24) return `${totalHours}h ${remainderMinutes}m`;
  const totalDays = Math.floor(totalHours / 24);
  const remainderHours = totalHours - totalDays * 24;
  return `${totalDays}d ${remainderHours}h`;
}
