/**
 * Reading and writing recordings on disk.
 *
 * The layout is deliberately plain files, so a recording stays useful without
 * this tool: `grep` finds a prompt, `jq` reads the index, and nothing is
 * locked behind a database.
 *
 *   <home>/sessions/<project>/<session>/session.json   what and where
 *                                      /index.jsonl     one line per call
 *                                      /calls/0001/request.json
 *                                                 /response.txt
 *                                                 /headers.json
 *
 * The index is the only file the list and chart views read. Prompt text can
 * run to megabytes per call, so it stays in the per-call files and is loaded
 * only when a single call is opened.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  AnthropicRequest,
  CallDetail,
  CallSummary,
  SessionListItem,
  SessionMeta,
} from "./types.js";
import { parseResponse } from "./capture.js";
import { callDir, ensureDir, sessionDir, sessionsRoot } from "./paths.js";

/** A session is treated as live while something wrote to it this recently. */
const LIVE_WINDOW_MS = 90_000;

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function writeSessionMeta(meta: SessionMeta): void {
  const dir = sessionDir(meta.project, meta.id);
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, "session.json"),
    JSON.stringify(meta, null, 2) + "\n"
  );
}

export function closeSession(meta: SessionMeta, endedAt: string): void {
  writeSessionMeta({ ...meta, endedAt });
}

export interface CallFiles {
  requestRaw: string;
  responseRaw: string;
  headers: Record<string, string>;
}

/** Append one call to a session: its files, then its index line. */
export function writeCall(
  meta: SessionMeta,
  summary: CallSummary,
  files: CallFiles
): void {
  const dir = callDir(meta.project, meta.id, summary.n);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "request.json"), files.requestRaw);
  fs.writeFileSync(path.join(dir, "response.txt"), files.responseRaw);
  fs.writeFileSync(
    path.join(dir, "headers.json"),
    JSON.stringify(files.headers, null, 2) + "\n"
  );

  // The index line is written last, so a reader never sees an index entry
  // whose files are not on disk yet.
  fs.appendFileSync(
    path.join(sessionDir(meta.project, meta.id), "index.jsonl"),
    JSON.stringify(summary) + "\n"
  );
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Every summary in a session.
 *
 * A malformed final line is skipped rather than thrown, because the recorder
 * may be mid-append while the UI is reading.
 */
export function readIndex(project: string, id: string): CallSummary[] {
  const file = path.join(sessionDir(project, id), "index.jsonl");
  if (!fs.existsSync(file)) return [];
  const out: CallSummary[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const parsed = readJsonLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

function readJsonLine(line: string): CallSummary | null {
  try {
    return JSON.parse(line) as CallSummary;
  } catch {
    return null;
  }
}

/** Every recorded session, newest first. */
export function listSessions(): SessionListItem[] {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) return [];

  const items: SessionListItem[] = [];
  for (const project of safeReaddir(root)) {
    for (const id of safeReaddir(path.join(root, project))) {
      const dir = path.join(root, project, id);
      if (!isDirectory(dir)) continue;
      const meta =
        readJson<SessionMeta>(path.join(dir, "session.json")) ??
        ({ id, project, cwd: "", startedAt: id, args: [] } satisfies SessionMeta);

      const calls = readIndex(project, id);
      const totals = calls.reduce(
        (acc, call) => {
          acc.totalBytes += call.totalBytes;
          acc.inputTokens += call.usage.input_tokens ?? 0;
          acc.cacheReadTokens += call.usage.cache_read_input_tokens ?? 0;
          acc.cacheCreationTokens += call.usage.cache_creation_input_tokens ?? 0;
          acc.outputTokens += call.usage.output_tokens ?? 0;
          return acc;
        },
        {
          totalBytes: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
        }
      );

      const lastActivity = mtime(path.join(dir, "index.jsonl")) ?? meta.startedAt;
      items.push({
        ...meta,
        ...totals,
        calls: calls.length,
        lastActivity,
        // An unfinished session that was written to recently is still running.
        // A crashed recorder leaves no `endedAt`, so time has to settle it.
        live:
          !meta.endedAt &&
          Date.now() - new Date(lastActivity).getTime() < LIVE_WINDOW_MS,
      });
    }
  }

  // Sorted by id, not by startedAt. An id is always present and always the
  // same fixed-width format, whereas a session whose session.json is missing
  // falls back to a synthesised startedAt in a different shape, which would
  // then sort inconsistently against the real ISO ones.
  return items.sort((a, b) => b.id.localeCompare(a.id));
}

/** One session's metadata and every call summary in it. */
export function readSession(
  project: string,
  id: string
): { meta: SessionMeta; calls: CallSummary[] } | null {
  const dir = sessionDir(project, id);
  if (!isDirectory(dir)) return null;
  const meta =
    readJson<SessionMeta>(path.join(dir, "session.json")) ??
    ({ id, project, cwd: "", startedAt: id, args: [] } satisfies SessionMeta);
  return { meta, calls: readIndex(project, id) };
}

/** Everything one call detail view needs, assembled from the per-call files. */
export function readCall(
  project: string,
  id: string,
  n: number
): CallDetail | null {
  const summary = readIndex(project, id).find((call) => call.n === n);
  if (!summary) return null;

  const dir = callDir(project, id, n);
  const requestRaw = safeRead(path.join(dir, "request.json"));
  const responseRaw = safeRead(path.join(dir, "response.txt"));

  let request: AnthropicRequest | null = null;
  try {
    request = JSON.parse(requestRaw) as AnthropicRequest;
  } catch {
    request = null;
  }

  return {
    summary,
    request,
    requestRaw,
    response: parseResponse(responseRaw),
    headers: readJson<Record<string, string>>(path.join(dir, "headers.json")) ?? {},
  };
}

/** The raw bytes of one part of a call, for the raw view and for download. */
export function readCallRaw(
  project: string,
  id: string,
  n: number,
  part: "request" | "response"
): string | null {
  const file = path.join(
    callDir(project, id, n),
    part === "request" ? "request.json" : "response.txt"
  );
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export function deleteSession(project: string, id: string): boolean {
  const dir = sessionDir(project, id);
  if (!isDirectory(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  // A project directory left empty is noise in the sidebar.
  const projectDir = path.join(sessionsRoot(), project);
  if (safeReaddir(projectDir).length === 0) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  return true;
}

export function deleteAllSessions(): void {
  fs.rmSync(sessionsRoot(), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Filesystem helpers that never throw
// ---------------------------------------------------------------------------

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function mtime(file: string): string | null {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}
