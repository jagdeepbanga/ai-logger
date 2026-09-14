import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallSummary, SessionMeta } from "../src/types.js";
import { projectSlug, sessionId } from "../src/paths.js";
import {
  closeSession,
  deleteAllSessions,
  deleteSession,
  listSessions,
  readCall,
  readCallRaw,
  readIndex,
  readSession,
  writeCall,
  writeSessionMeta,
} from "../src/store.js";

let tempHome: string;

beforeEach(() => {
  // Every test gets its own recordings directory, so a test run can never
  // read or delete a real recording.
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "llmlogger-test-"));
  process.env.LLMLOGGER_HOME = tempHome;
});

afterEach(() => {
  delete process.env.LLMLOGGER_HOME;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

const meta: SessionMeta = {
  id: "2026-09-14T12-00-00",
  project: "my-app",
  cwd: "/tmp/my-app",
  startedAt: "2026-09-14T12:00:00.000Z",
  args: ["--resume"],
};

function summary(n: number, overrides: Partial<CallSummary> = {}): CallSummary {
  return {
    n,
    time: `2026-09-14T12:0${n}:00.000Z`,
    durationMs: 1000,
    status: 200,
    model: "claude-opus-5",
    stream: true,
    totalBytes: 1000 * n,
    systemBytes: 100,
    toolBytes: 500,
    messageBytes: 300,
    systemChars: 90,
    toolCount: 2,
    mcpToolCount: 0,
    messageCount: n,
    cacheBreakpoints: 3,
    skills: ["tdd"],
    tools: [{ name: "Bash", bytes: 500, mcp: false }],
    toolsCalled: ["Bash"],
    stopReason: "end_turn",
    usage: { input_tokens: 10, cache_read_input_tokens: 2000, output_tokens: 50 },
    responseChars: 20,
    thinkingChars: 0,
    ...overrides,
  };
}

describe("paths", () => {
  it("makes a directory name safe", () => {
    expect(projectSlug("/Users/me/My App (v2)")).toBe("My-App--v2-");
  });

  it("never produces a hidden directory", () => {
    // A leading dot would hide the recording from an ordinary `ls`, and a
    // leading dash reads as a flag in any command the user runs on it.
    expect(projectSlug("/Users/me/.config")).toBe("config");
    expect(projectSlug("/")).toBe("root");
  });

  it("makes a sortable session id with no colons", () => {
    const id = sessionId(new Date("2026-09-14T12:38:13.456Z"));
    expect(id).toBe("2026-09-14T12-38-13");
    expect(id).not.toContain(":");
  });
});

describe("store round trip", () => {
  it("writes and reads a session with its calls", () => {
    writeSessionMeta(meta);
    writeCall(meta, summary(1), {
      requestRaw: '{"model":"claude-opus-5"}',
      responseRaw: "data: {}",
      headers: { "user-agent": "claude-cli", authorization: "<redacted>" },
    });
    writeCall(meta, summary(2), {
      requestRaw: "{}",
      responseRaw: "",
      headers: {},
    });

    const index = readIndex(meta.project, meta.id);
    expect(index.map((call) => call.n)).toEqual([1, 2]);

    const session = readSession(meta.project, meta.id);
    expect(session?.meta.args).toEqual(["--resume"]);
    expect(session?.calls).toHaveLength(2);

    const detail = readCall(meta.project, meta.id, 1);
    expect(detail?.request?.model).toBe("claude-opus-5");
    expect(detail?.headers.authorization).toBe("<redacted>");
  });

  it("reads raw parts back byte for byte", () => {
    writeSessionMeta(meta);
    writeCall(meta, summary(1), {
      requestRaw: '{"a":1}',
      responseRaw: "data: [DONE]",
      headers: {},
    });
    expect(readCallRaw(meta.project, meta.id, 1, "request")).toBe('{"a":1}');
    expect(readCallRaw(meta.project, meta.id, 1, "response")).toBe("data: [DONE]");
  });

  it("keeps a call whose request body was not JSON", () => {
    writeSessionMeta(meta);
    writeCall(meta, summary(1), {
      requestRaw: "not json at all",
      responseRaw: "",
      headers: {},
    });
    const detail = readCall(meta.project, meta.id, 1);
    expect(detail?.request).toBeNull();
    expect(detail?.requestRaw).toBe("not json at all");
  });

  it("skips a half-written index line instead of throwing", () => {
    // The viewer polls while the recorder appends, so it can read the file
    // mid-write. Losing one line is acceptable; losing the session is not.
    writeSessionMeta(meta);
    writeCall(meta, summary(1), { requestRaw: "{}", responseRaw: "", headers: {} });
    const indexFile = path.join(tempHome, "sessions", meta.project, meta.id, "index.jsonl");
    fs.appendFileSync(indexFile, '{"n":2,"time":"2026-');
    expect(readIndex(meta.project, meta.id)).toHaveLength(1);
  });

  it("returns null for a session that does not exist", () => {
    expect(readSession("nope", "nope")).toBeNull();
    expect(readCall("nope", "nope", 1)).toBeNull();
    expect(readCallRaw("nope", "nope", 1, "request")).toBeNull();
  });

  it("has no sessions before anything is recorded", () => {
    expect(listSessions()).toEqual([]);
  });
});

describe("listSessions", () => {
  it("totals the usage across calls", () => {
    writeSessionMeta(meta);
    writeCall(meta, summary(1), { requestRaw: "{}", responseRaw: "", headers: {} });
    writeCall(meta, summary(2), { requestRaw: "{}", responseRaw: "", headers: {} });

    const [item] = listSessions();
    expect(item?.calls).toBe(2);
    expect(item?.totalBytes).toBe(3000);
    expect(item?.outputTokens).toBe(100);
    expect(item?.cacheReadTokens).toBe(4000);
  });

  it("sorts newest first", () => {
    writeSessionMeta({ ...meta, id: "2026-09-13T09-00-00" });
    writeSessionMeta({ ...meta, id: "2026-09-14T09-00-00" });
    expect(listSessions().map((s) => s.id)).toEqual([
      "2026-09-14T09-00-00",
      "2026-09-13T09-00-00",
    ]);
  });

  it("treats a session with an end time as finished", () => {
    writeSessionMeta(meta);
    writeCall(meta, summary(1), { requestRaw: "{}", responseRaw: "", headers: {} });
    closeSession(meta, "2026-09-14T12:05:00.000Z");
    expect(listSessions()[0]?.live).toBe(false);
  });

  it("treats a just-written session with no end time as live", () => {
    // A recorder that is killed leaves no end time, so recency is what
    // separates running from crashed.
    writeSessionMeta(meta);
    writeCall(meta, summary(1), { requestRaw: "{}", responseRaw: "", headers: {} });
    expect(listSessions()[0]?.live).toBe(true);
  });

  it("survives a session directory with no session.json", () => {
    const dir = path.join(tempHome, "sessions", "orphan", "2026-09-14T10-00-00");
    fs.mkdirSync(dir, { recursive: true });
    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.project).toBe("orphan");
  });
});

describe("deleting", () => {
  it("removes one session and prunes its empty project", () => {
    writeSessionMeta(meta);
    expect(deleteSession(meta.project, meta.id)).toBe(true);
    expect(listSessions()).toEqual([]);
    expect(fs.existsSync(path.join(tempHome, "sessions", meta.project))).toBe(false);
  });

  it("keeps the project when it still holds another session", () => {
    writeSessionMeta(meta);
    writeSessionMeta({ ...meta, id: "2026-09-14T13-00-00" });
    deleteSession(meta.project, meta.id);
    expect(listSessions().map((s) => s.id)).toEqual(["2026-09-14T13-00-00"]);
  });

  it("reports a miss rather than throwing", () => {
    expect(deleteSession("nope", "nope")).toBe(false);
  });

  it("removes everything", () => {
    writeSessionMeta(meta);
    writeSessionMeta({ ...meta, project: "other" });
    deleteAllSessions();
    expect(listSessions()).toEqual([]);
  });
});
