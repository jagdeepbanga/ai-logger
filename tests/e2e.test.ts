/**
 * The whole path, end to end: an agent makes a request, the recorder forwards
 * it to an upstream, streams the reply back, and writes a capture.
 *
 * The "agent" is a short Node script and the "upstream" is a local server that
 * speaks the Anthropic event format. Nothing here touches the network or a
 * real API key, so this runs in CI.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { run, upstreamConnection } from "../src/recorder.js";
import { listSessions, readCall } from "../src/store.js";

let tempHome: string;
let upstream: http.Server;
let upstreamUrl: string;
const seen: Array<{ path: string; auth?: string; encoding?: string; body: string }> = [];

const STREAM = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":11,"cache_read_input_tokens":2200}}}',
  '',
  'data: {"type":"content_block_start","content_block":{"type":"text"}}',
  '',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"pong"}}',
  '',
  'data: {"type":"content_block_stop"}',
  '',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
  '',
].join("\n");

beforeEach(async () => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "llmlogger-e2e-"));
  process.env.LLMLOGGER_HOME = tempHome;
  seen.length = 0;

  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        path: req.url ?? "",
        auth: req.headers.authorization,
        encoding: req.headers["content-encoding"] as string | undefined,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(STREAM);
    });
  });

  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  delete process.env.LLMLOGGER_HOME;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

/** A stand-in agent: posts to whatever ANTHROPIC_BASE_URL it is handed. */
const AGENT = `
const base = process.env.ANTHROPIC_BASE_URL;
if (!base) { console.error("no base url"); process.exit(2); }
const send = (path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  }).then((r) => r.text());

const request = {
  model: "claude-opus-5",
  max_tokens: 1024,
  stream: true,
  system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "Bash", description: "Run a command", input_schema: { type: "object" } }],
  messages: [{ role: "user", content: "ping" }],
};

await send("/v1/messages/count_tokens", request);
const reply = await send("/v1/messages", request);
if (!reply.includes("pong")) { console.error("no pong in reply"); process.exit(3); }
`;

describe("upstreamConnection", () => {
  it("assumes https for a bare hostname", () => {
    expect(upstreamConnection("api.anthropic.com")).toEqual({
      hostname: "api.anthropic.com",
      port: 443,
      useHttps: true,
    });
  });

  it("honours an explicit scheme and port", () => {
    expect(upstreamConnection("http://127.0.0.1:9000")).toEqual({
      hostname: "127.0.0.1",
      port: 9000,
      useHttps: false,
    });
  });

  it("defaults the port from the scheme", () => {
    expect(upstreamConnection("http://localhost").port).toBe(80);
  });
});

describe("recording a session", () => {
  it("forwards, streams back, and records only the generation call", async () => {
    const result = await run({
      bin: process.execPath,
      args: ["--input-type=module", "-e", AGENT],
      cwd: tempHome,
      upstream: upstreamUrl,
    });

    // The agent exiting 0 means it received "pong" through the proxy, so the
    // response really was streamed back and not just captured.
    expect(result.exitCode).toBe(0);

    // Both calls reached upstream; only one was recorded.
    expect(seen.map((r) => r.path)).toEqual([
      "/v1/messages/count_tokens",
      "/v1/messages",
    ]);
    expect(result.totals.generations).toBe(1);
    expect(result.totals.countTokenCalls).toBe(1);
    expect(result.totals.errors).toBe(0);

    // The credential passed through untouched, or the real API would reject it.
    expect(seen[1]?.auth).toBe("Bearer test-token");

    const [session] = listSessions();
    expect(session?.calls).toBe(1);
    expect(session?.cwd).toBe(tempHome);
    expect(session?.live).toBe(false); // the recorder closed it on exit

    const detail = readCall(session!.project, session!.id, 1);
    expect(detail?.summary.model).toBe("claude-opus-5");
    expect(detail?.summary.toolCount).toBe(1);
    expect(detail?.summary.cacheBreakpoints).toBe(1);
    expect(detail?.summary.messageCount).toBe(1);
    expect(detail?.response.text).toBe("pong");
    expect(detail?.response.stopReason).toBe("end_turn");
    expect(detail?.summary.usage).toEqual({
      input_tokens: 11,
      cache_read_input_tokens: 2200,
      output_tokens: 3,
    });

    // The stored copy must never hold the real credential.
    expect(detail?.headers.authorization).toBe("<redacted>");
    const onDisk = fs.readFileSync(
      path.join(tempHome, "sessions", session!.project, session!.id, "calls", "0001", "headers.json"),
      "utf8"
    );
    expect(onDisk).not.toContain("test-token");

    // Totals follow the recorded usage.
    expect(result.totals.outputTokens).toBe(3);
    expect(result.totals.cacheReadTokens).toBe(2200);
  });

  it("hands the agent the environment it needs", async () => {
    const probe = `
      const out = [process.env.ANTHROPIC_BASE_URL, process.env.ENABLE_TOOL_SEARCH].join("|");
      require("node:fs").writeFileSync(process.env.PROBE_FILE, out);
    `;
    const probeFile = path.join(tempHome, "probe.txt");
    process.env.PROBE_FILE = probeFile;

    await run({
      bin: process.execPath,
      args: ["-e", probe],
      cwd: tempHome,
      upstream: upstreamUrl,
    });

    const [baseUrl, toolSearch] = fs.readFileSync(probeFile, "utf8").split("|");
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // Without this, Claude Code inlines every tool schema and the recording is
    // bigger than a real request and the wrong shape.
    expect(toolSearch).toBe("true");
    delete process.env.PROBE_FILE;
  });

  it("reports a missing agent binary rather than hanging", async () => {
    await expect(
      run({
        bin: "definitely-not-a-real-binary-xyz",
        args: [],
        cwd: tempHome,
        upstream: upstreamUrl,
      })
    ).rejects.toThrow(/could not start/);
  });

  it("records a session even when the agent makes no calls", async () => {
    const result = await run({
      bin: process.execPath,
      args: ["-e", "0"],
      cwd: tempHome,
      upstream: upstreamUrl,
    });
    expect(result.totals.generations).toBe(0);
    expect(listSessions()).toHaveLength(1);
  });
});
