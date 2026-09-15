/**
 * The HTTP API, exercised over a real socket.
 *
 * Started with port 0 so the test never collides with a viewer the developer
 * has open.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { CallSummary, SessionMeta } from "../src/types.js";
import { startServer, type ServerHandle } from "../src/server.js";
import { writeCall, writeSessionMeta } from "../src/store.js";

let tempHome: string;
let server: ServerHandle;
let base: string;

const meta: SessionMeta = {
  id: "2026-09-14T12-00-00",
  project: "my-app",
  cwd: "/tmp/my-app",
  startedAt: "2026-09-14T12:00:00.000Z",
  args: [],
};

const summary: CallSummary = {
  n: 1,
  time: "2026-09-14T12:00:01.000Z",
  durationMs: 900,
  status: 200,
  model: "claude-opus-5",
  stream: true,
  totalBytes: 120,
  systemBytes: 40,
  toolBytes: 50,
  messageBytes: 30,
  systemChars: 30,
  toolCount: 1,
  mcpToolCount: 0,
  messageCount: 1,
  cacheBreakpoints: 1,
  skills: ["tdd"],
  tools: [{ name: "Bash", bytes: 50, mcp: false }],
  toolsCalled: [],
  stopReason: "end_turn",
  usage: { input_tokens: 4, output_tokens: 9 },
  responseChars: 2,
  thinkingChars: 0,
};

beforeEach(async () => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "ai-logger-srv-"));
  process.env.AI_LOGGER_HOME = tempHome;
  writeSessionMeta(meta);
  writeCall(meta, summary, {
    requestRaw: '{"model":"claude-opus-5","messages":[]}',
    responseRaw: 'data: {"type":"message_stop"}',
    headers: { authorization: "<redacted>", "user-agent": "claude-cli" },
  });
  server = await startServer(0);
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  await server.close();
  delete process.env.AI_LOGGER_HOME;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("GET /api/sessions", () => {
  it("lists what was recorded", async () => {
    const response = await fetch(`${base}/api/sessions`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sessions: Array<{ project: string; calls: number }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.project).toBe("my-app");
    expect(body.sessions[0]?.calls).toBe(1);
  });
});

describe("GET /api/sessions/:project/:id", () => {
  it("returns the session and its calls", async () => {
    const response = await fetch(`${base}/api/sessions/my-app/2026-09-14T12-00-00`);
    const body = (await response.json()) as { calls: CallSummary[] };
    expect(body.calls[0]?.model).toBe("claude-opus-5");
  });

  it("is a 404 for a session that does not exist", async () => {
    const response = await fetch(`${base}/api/sessions/nope/nope`);
    expect(response.status).toBe(404);
  });
});

describe("GET /api/sessions/:project/:id/calls/:n", () => {
  it("returns the parsed request and response", async () => {
    const response = await fetch(`${base}/api/sessions/my-app/2026-09-14T12-00-00/calls/1`);
    const body = (await response.json()) as {
      request: { model: string };
      headers: Record<string, string>;
    };
    expect(body.request.model).toBe("claude-opus-5");
    expect(body.headers.authorization).toBe("<redacted>");
  });

  it("serves the raw parts as plain text", async () => {
    const request = await fetch(
      `${base}/api/sessions/my-app/2026-09-14T12-00-00/calls/1/raw?part=request`
    );
    expect(request.headers.get("content-type")).toContain("text/plain");
    expect(await request.text()).toContain("claude-opus-5");

    const streamed = await fetch(
      `${base}/api/sessions/my-app/2026-09-14T12-00-00/calls/1/raw?part=response`
    );
    expect(await streamed.text()).toContain("message_stop");
  });

  it("rejects a call number that is not a number", async () => {
    const response = await fetch(`${base}/api/sessions/my-app/2026-09-14T12-00-00/calls/abc`);
    expect(response.status).toBe(400);
  });

  it("is a 404 for a call that was never recorded", async () => {
    const response = await fetch(`${base}/api/sessions/my-app/2026-09-14T12-00-00/calls/99`);
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/sessions/:project/:id", () => {
  it("removes the recording", async () => {
    const response = await fetch(`${base}/api/sessions/my-app/2026-09-14T12-00-00`, {
      method: "DELETE",
    });
    expect((await response.json()) as { deleted: boolean }).toEqual({ deleted: true });

    const list = (await (await fetch(`${base}/api/sessions`)).json()) as { sessions: unknown[] };
    expect(list.sessions).toHaveLength(0);
  });
});

describe("static files", () => {
  it("does not serve files from outside the UI directory", async () => {
    // A path that climbs out must fall back to the application, never reach
    // the filesystem.
    const response = await fetch(`${base}/../../../../etc/passwd`);
    const text = await response.text();
    expect(text).not.toContain("root:");
  });

  it("answers an unknown API route with a 404", async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});

describe("GET /api/events", () => {
  it("opens an event stream", async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  });
});

describe("a session id from the URL cannot escape the recordings directory", () => {
  it("refuses a project or id containing a path segment", async () => {
    for (const target of [
      `${base}/api/sessions/..%2F/anything`,
      `${base}/api/sessions/my-app/..%2F..%2Fanything`,
      `${base}/api/sessions/..%2F/anything/calls/1`,
      `${base}/api/sessions/..%2F/anything/calls/1/raw?part=request`,
    ]) {
      expect((await fetch(target)).status).toBe(400);
    }
  });

  it("does not delete a directory outside the recordings root", async () => {
    // The severe form: DELETE lands in a recursive remove, so a climbing
    // path would take somewhere else on disk with it.
    const outside = path.join(tempHome, "not-a-recording");
    fs.mkdirSync(outside, { recursive: true });

    const response = await fetch(`${base}/api/sessions/..%2F/not-a-recording`, {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe("the Host header", () => {
  // `fetch` refuses to set Host, so these go over a raw socket — which is
  // also closer to what a rebinding browser actually sends.
  const getWithHost = (host: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port: server.port, path: "/api/sessions", headers: { host } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        }
      );
      request.on("error", reject);
      request.end();
    });

  it("is refused when it is not a loopback name", async () => {
    // What a DNS-rebinding page would send: the socket is loopback, the name
    // the browser used is not.
    expect(await getWithHost("recordings.attacker.example")).toBe(403);
  });

  it("is accepted for localhost and for an IPv6 loopback literal", async () => {
    expect(await getWithHost(`localhost:${server.port}`)).toBe(200);
    expect(await getWithHost(`[::1]:${server.port}`)).toBe(200);
  });
});
