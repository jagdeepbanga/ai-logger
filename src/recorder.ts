/**
 * The recorder: a proxy that sits between Claude Code and the Anthropic API.
 *
 * It listens on a port the operating system picks, forwards every request
 * upstream untouched — auth header included, so a subscription login keeps
 * working — and streams the response straight back as it arrives, so the agent
 * behaves exactly as it would without the recorder. Only a copy is kept.
 *
 * Claude Code is then launched as a child process with `ANTHROPIC_BASE_URL`
 * already pointing here. Handing the agent its environment rather than asking
 * a human to export a variable removes the common failure: an agent reads that
 * variable once, at startup, so starting it in the wrong order records nothing
 * and looks identical to a broken tool.
 */

import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { AnthropicRequest, SessionMeta } from "./types.js";
import { decodeBody, measure, parseResponse } from "./capture.js";
import { closeSession, writeCall, writeSessionMeta } from "./store.js";
import { projectSlug, sessionId } from "./paths.js";

const DEFAULT_UPSTREAM = "https://api.anthropic.com";

/** Headers that must never reach a file on disk. */
const SECRET_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

export interface RecorderTotals {
  generations: number;
  countTokenCalls: number
  otherCalls: number;
  errors: number;
  requestBytes: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface RunOptions {
  /** The binary to launch, and its arguments. Defaults to `claude`. */
  bin: string;
  args: string[];
  cwd: string;
  upstream?: string;
  /** Called once the proxy is listening, before the agent starts. */
  onReady?: (info: { baseUrl: string; session: SessionMeta }) => void;
}

export interface RunResult {
  session: SessionMeta;
  totals: RecorderTotals;
  exitCode: number;
}

/**
 * Record one agent session, resolving when the agent exits.
 */
export function run(options: RunOptions): Promise<RunResult> {
  const upstream = options.upstream ?? process.env.AI_LOGGER_UPSTREAM ?? DEFAULT_UPSTREAM;
  const project = projectSlug(options.cwd);
  const session: SessionMeta = {
    id: sessionId(),
    project,
    cwd: options.cwd,
    startedAt: new Date().toISOString(),
    args: options.args,
  };
  writeSessionMeta(session);

  const totals: RecorderTotals = {
    generations: 0,
    countTokenCalls: 0,
    otherCalls: 0,
    errors: 0,
    requestBytes: 0,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
  };

  let seq = 0;

  const server = http.createServer((req, res) => {
    const reqPath = req.url ?? "/";
    const method = (req.method ?? "POST").toUpperCase();
    const logged = isGeneration(method, reqPath);
    const n = logged ? ++seq : 0;
    const startedAt = Date.now();
    const time = new Date().toISOString();

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);

      const { hostname, port, useHttps } = upstreamConnection(upstream);
      const transport = useHttps ? https : http;
      const upstreamReq = transport.request(
        {
          hostname,
          port,
          path: reqPath,
          method,
          headers: { ...forwardHeaders(req.headers, body), host: hostname },
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          const responseChunks: Buffer[] = [];
          upstreamRes.on("data", (chunk: Buffer) => {
            responseChunks.push(chunk);
            res.write(chunk); // straight back to the agent, unbuffered
          });
          upstreamRes.on("end", () => {
            res.end();
            const status = upstreamRes.statusCode ?? 0;
            if (status >= 400) totals.errors++;

            if (!logged) {
              if (reqPath.includes("count_tokens")) totals.countTokenCalls++;
              else totals.otherCalls++;
              return;
            }

            record({
              session,
              totals,
              n,
              time,
              durationMs: Date.now() - startedAt,
              status,
              headers: req.headers,
              body,
              responseRaw: Buffer.concat(responseChunks).toString("utf8"),
            });
          });
        }
      );

      upstreamReq.on("error", (err) => {
        totals.errors++;
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: `ai-logger upstream error: ${err.message}` }));
      });

      if (body.length > 0) upstreamReq.write(body);
      upstreamReq.end();
    });
  });

  return new Promise<RunResult>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${port}`;
      options.onReady?.({ baseUrl, session });

      const child = spawn(options.bin, options.args, {
        cwd: options.cwd,
        stdio: "inherit",
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: baseUrl,
          // Claude Code trusts one host. Pointed anywhere else it turns off
          // tool search, stops deferring tool schemas and inlines every one of
          // them, so the recording would be far larger than a real request and
          // the wrong shape. Setting this keeps the capture honest.
          ENABLE_TOOL_SEARCH: "true",
        },
      });

      child.on("error", (err) => {
        server.close();
        reject(new Error(`could not start "${options.bin}": ${err.message}`));
      });

      child.on("exit", (code, signal) => {
        server.close();
        closeSession(session, new Date().toISOString());
        resolve({ session, totals, exitCode: signal ? 1 : (code ?? 0) });
      });

      // Ctrl+C belongs to the agent while it is in the foreground; it will
      // exit and the `exit` handler above finishes the session cleanly.
      process.on("SIGINT", () => {});
      process.on("SIGTERM", () => child.kill("SIGTERM"));
    });
  });
}

/**
 * A generation call is the only one that carries the prompt and the tools.
 *
 * A turn also fans out into token-counting calls that measure sizes for the
 * context bar, for caching and for compaction. They return a number rather
 * than model output, so they are forwarded but not recorded — keeping them
 * would bury every real turn under housekeeping. They are still counted, so
 * the fan-out stays visible.
 */
export function isGeneration(method: string, reqPath: string): boolean {
  return (
    method.toUpperCase() === "POST" &&
    reqPath.includes("/messages") &&
    !reqPath.includes("count_tokens")
  );
}

/**
 * Headers forwarded upstream.
 *
 * Hop-by-hop headers are dropped and an uncompressed response is asked for, so
 * the recording is readable. The request body's own `content-encoding` is kept
 * deliberately: upstream must receive the exact bytes the agent produced, and
 * only the copy written to disk is decoded.
 */
export function forwardHeaders(
  headers: http.IncomingHttpHeaders,
  body: Buffer
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...headers };
  delete out["host"];
  delete out["connection"];
  delete out["accept-encoding"];
  delete out["transfer-encoding"];
  delete out["content-length"];
  if (body.length > 0) out["content-length"] = String(body.length);
  return out;
}

/** Request headers as they are safe to store: secrets replaced, not omitted. */
export function redactHeaders(
  headers: http.IncomingHttpHeaders
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? "<redacted>" : text;
  }
  return out;
}

/**
 * Where a target's traffic actually goes: a scheme, a host and a port.
 *
 * The upstream is accepted as a full URL rather than a bare hostname so that
 * it can be a local server — a gateway in front of the API, or the fake
 * upstream the end-to-end test drives. A bare hostname is still accepted and
 * assumed to be HTTPS, which is what every real provider is.
 */
export function upstreamConnection(upstream: string): {
  hostname: string;
  port: number;
  useHttps: boolean;
} {
  const withScheme = /^https?:\/\//.test(upstream) ? upstream : `https://${upstream}`;
  const url = new URL(withScheme);
  const useHttps = url.protocol === "https:";
  return {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : useHttps ? 443 : 80,
    useHttps,
  };
}

interface RecordInput {
  session: SessionMeta;
  totals: RecorderTotals;
  n: number;
  time: string;
  durationMs: number;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  responseRaw: string;
}

function record(input: RecordInput): void {
  try {
    const requestRaw = decodeBody(input.body, input.headers["content-encoding"]);
    let request: AnthropicRequest | null = null;
    try {
      request = JSON.parse(requestRaw) as AnthropicRequest;
    } catch {
      request = null;
    }

    const response = parseResponse(input.responseRaw);
    const summary = measure({
      n: input.n,
      time: input.time,
      durationMs: input.durationMs,
      status: input.status,
      requestRaw,
      request,
      response,
    });

    writeCall(input.session, summary, {
      requestRaw,
      responseRaw: input.responseRaw,
      headers: redactHeaders(input.headers),
    });

    const { totals } = input;
    totals.generations++;
    totals.requestBytes += summary.totalBytes;
    totals.inputTokens += summary.usage.input_tokens ?? 0;
    totals.cacheCreationTokens += summary.usage.cache_creation_input_tokens ?? 0;
    totals.cacheReadTokens += summary.usage.cache_read_input_tokens ?? 0;
    totals.outputTokens += summary.usage.output_tokens ?? 0;
  } catch {
    // A recording failure must never break the agent's turn. The response has
    // already been delivered by the time this runs.
    input.totals.errors++;
  }
}
