/**
 * The viewer's HTTP server: a small JSON API, plus the built UI as static
 * files.
 *
 * It binds to loopback only. A recording holds the full text of every prompt
 * and every file the agent read, so it must not be reachable from the network
 * the machine happens to be on.
 *
 * Live updates use server-sent events driven by a filesystem watch. Polling
 * would work, but a watch means an active session's calls appear as they are
 * written without the viewer asking every second.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteSession,
  listSessions,
  readCall,
  readCallRaw,
  readSession,
} from "./store.js";
import { sessionsRoot } from "./paths.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(HERE, "ui");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}

export function startServer(port: number): Promise<ServerHandle> {
  const clients = new Set<http.ServerResponse>();
  const server = http.createServer((req, res) => {
    try {
      route(req, res, clients);
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  const stopWatching = watchSessions(clients);

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port: (server.address() as { port: number }).port,
        close: () =>
          new Promise<void>((done) => {
            stopWatching();
            for (const client of clients) client.end();
            server.close(() => done());
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  clients: Set<http.ServerResponse>
): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "api") {
    serveStatic(url.pathname, res);
    return;
  }

  // GET /api/events — server-sent events, one message per change on disk.
  if (parts[1] === "events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // GET /api/sessions
  if (parts[1] === "sessions" && parts.length === 2) {
    json(res, 200, { sessions: listSessions() });
    return;
  }

  // /api/sessions/:project/:id[...]
  if (parts[1] === "sessions" && parts.length >= 4) {
    const project = decodeURIComponent(parts[2]!);
    const id = decodeURIComponent(parts[3]!);

    if (parts.length === 4) {
      if (req.method === "DELETE") {
        json(res, 200, { deleted: deleteSession(project, id) });
        return;
      }
      const session = readSession(project, id);
      if (!session) {
        json(res, 404, { error: "no such session" });
        return;
      }
      json(res, 200, session);
      return;
    }

    // /api/sessions/:project/:id/calls/:n[/raw]
    if (parts[4] === "calls" && parts[5]) {
      const n = Number(parts[5]);
      if (!Number.isInteger(n)) {
        json(res, 400, { error: "call number must be an integer" });
        return;
      }

      if (parts[6] === "raw") {
        const part = url.searchParams.get("part") === "response" ? "response" : "request";
        const raw = readCallRaw(project, id, n, part);
        if (raw === null) {
          json(res, 404, { error: "no such call" });
          return;
        }
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(raw);
        return;
      }

      const detail = readCall(project, id, n);
      if (!detail) {
        json(res, 404, { error: "no such call" });
        return;
      }
      json(res, 200, detail);
      return;
    }
  }

  json(res, 404, { error: "unknown endpoint" });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

function serveStatic(pathname: string, res: http.ServerResponse): void {
  if (!fs.existsSync(UI_DIR)) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("The UI has not been built. Run: npm run build");
    return;
  }

  // Every unknown path falls back to index.html, because the viewer routes
  // client-side and a deep link must still load the application.
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.join(UI_DIR, path.normalize(requested));

  // path.normalize collapses `..`, but a crafted path could still escape the
  // UI directory, so the result is checked rather than trusted.
  const file =
    resolved.startsWith(UI_DIR) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
      ? resolved
      : path.join(UI_DIR, "index.html");

  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "content-length": body.length,
    // Hashed asset names make long caching safe; index.html must not be
    // cached or a rebuilt UI would keep serving the old bundle.
    "cache-control": file.endsWith("index.html") ? "no-store" : "max-age=31536000",
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

/**
 * Tell connected viewers when anything under the sessions directory changes.
 *
 * Changes are coalesced: a single call writes four files, and a recursive
 * watch reports directory events too, so sending one message per raw event
 * would mean several redundant refetches for every turn.
 */
function watchSessions(clients: Set<http.ServerResponse>): () => void {
  const root = sessionsRoot();
  fs.mkdirSync(root, { recursive: true });

  let timer: NodeJS.Timeout | null = null;
  const notify = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      for (const client of clients) {
        client.write(`data: ${JSON.stringify({ type: "changed" })}\n\n`);
      }
    }, 250);
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(root, { recursive: true }, notify);
  } catch {
    // Recursive watching is not available everywhere. The viewer still works;
    // it simply refetches when the user asks rather than on its own.
  }

  // A heartbeat keeps the connection open through proxies and lets the viewer
  // notice a dropped server.
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, 30_000);

  return () => {
    watcher?.close();
    clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
  };
}
