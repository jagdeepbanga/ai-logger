/**
 * The viewer's data layer.
 *
 * Every call goes to the CLI's own server on the same origin, so there is no
 * configuration and no CORS. `subscribe` opens the server-sent-event stream
 * the server drives from a filesystem watch, which is what makes a session
 * that is still running appear live without polling.
 */

import type { CallDetail, CallSummary, SessionListItem, SessionMeta } from "../../src/types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function fetchSessions(): Promise<{ sessions: SessionListItem[] }> {
  return get("/api/sessions");
}

export function fetchSession(
  project: string,
  id: string
): Promise<{ meta: SessionMeta; calls: CallSummary[] }> {
  return get(`/api/sessions/${encodeURIComponent(project)}/${encodeURIComponent(id)}`);
}

export function fetchCall(project: string, id: string, n: number): Promise<CallDetail> {
  return get(
    `/api/sessions/${encodeURIComponent(project)}/${encodeURIComponent(id)}/calls/${n}`
  );
}

export function rawUrl(
  project: string,
  id: string,
  n: number,
  part: "request" | "response"
): string {
  return `/api/sessions/${encodeURIComponent(project)}/${encodeURIComponent(
    id
  )}/calls/${n}/raw?part=${part}`;
}

export async function deleteSession(project: string, id: string): Promise<void> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(project)}/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (!response.ok) throw new Error("could not delete that recording");
}

/** Call `onChange` whenever a recording changes on disk. Returns a canceller. */
export function subscribe(onChange: () => void): () => void {
  const source = new EventSource("/api/events");
  source.onmessage = () => onChange();
  // A dropped connection is retried by EventSource on its own, so an error
  // handler only needs to avoid throwing.
  source.onerror = () => {};
  return () => source.close();
}
