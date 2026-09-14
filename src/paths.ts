/**
 * Where recordings live.
 *
 * Outside the project being recorded, always. A capture holds the whole
 * conversation and every file the agent read, so writing it into the working
 * tree would mean a `.gitignore` entry in every repo and a real chance of
 * committing source code and prompts by accident.
 *
 * `LLMLOGGER_HOME` overrides the location, which is what the tests use so that
 * they never touch a real recording.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function home(): string {
  return process.env.LLMLOGGER_HOME ?? path.join(os.homedir(), ".llmlogger");
}

export function sessionsRoot(): string {
  return path.join(home(), "sessions");
}

/** A filesystem-safe name for the project a session was recorded in. */
export function projectSlug(cwd: string): string {
  const base = path.basename(cwd) || "root";
  const slug = base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
  return slug.replace(/^[.-]+/, "") || "root";
}

/** A sortable, filesystem-safe session id: 2026-09-14T12-38-13. */
export function sessionId(now = new Date()): string {
  return now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

export function sessionDir(project: string, id: string): string {
  return path.join(sessionsRoot(), project, id);
}

export function callDir(project: string, id: string, n: number): string {
  return path.join(sessionDir(project, id), "calls", String(n).padStart(4, "0"));
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
