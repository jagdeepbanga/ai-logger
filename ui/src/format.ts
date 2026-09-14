/** Presentation helpers. Kept apart so components stay about layout. */

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function num(n: number | undefined): string {
  return (n ?? 0).toLocaleString();
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export function duration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** `12:38:13` from an ISO timestamp — the date is already in the session id. */
export function clock(iso: string): string {
  return iso.slice(11, 19);
}

/** `2026-09-14 12:38` from a session id like `2026-09-14T12-38-13`. */
export function sessionLabel(id: string): string {
  const [date, time] = id.split("T");
  if (!date || !time) return id;
  return `${date} ${time.slice(0, 5).replace("-", ":")}`;
}

/** Drop the date suffix that makes model ids too long for a table cell. */
export function shortModel(model: string): string {
  return model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
}

export function relative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
