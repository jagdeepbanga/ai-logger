#!/usr/bin/env node
/**
 * The `llmlogger` command.
 *
 *   llmlogger [claude args...]   record a Claude Code session in this directory
 *   llmlogger ui                 open the viewer
 *   llmlogger ls                 list recorded sessions
 *   llmlogger rm <id|--all>      delete recordings
 *   llmlogger where              print the recordings directory
 *
 * Recording is the bare command because it is the one run many times a day.
 * Every unrecognised argument is passed straight to Claude Code, so
 * `llmlogger --resume` and `llmlogger -p "..."` behave as expected; the subcommands
 * are matched only as the first argument.
 */

import { spawn } from "node:child_process";
import { run } from "./recorder.js";
import { startServer } from "./server.js";
import { deleteAllSessions, deleteSession, listSessions } from "./store.js";
import { home } from "./paths.js";

const DEFAULT_UI_PORT = 4747;

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;

const USAGE = `
${bold("llmlogger")} — see every request Claude Code sends to the model.

  ${bold("llmlogger")}                    record a Claude Code session here
  ${bold("llmlogger")} --resume           any claude flag is passed straight through
  ${bold("llmlogger ui")} [--port N]      open the viewer in a browser
  ${bold("llmlogger ls")}                 list recorded sessions
  ${bold("llmlogger rm")} <id>            delete one recording
  ${bold("llmlogger rm")} --all           delete every recording
  ${bold("llmlogger where")}              print the recordings directory

Recordings are kept in ${dim(home())}
`;

async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;

  switch (first) {
    case "ui":
      return commandUi(rest);
    case "ls":
    case "list":
      return commandList();
    case "rm":
      return commandRemove(rest);
    case "where":
      console.log(home());
      return 0;
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    case "version":
    case "--version":
      console.log(await version());
      return 0;
    default:
      return commandRecord(argv);
  }
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

async function commandRecord(args: string[]): Promise<number> {
  const bin = process.env.LLMLOGGER_AGENT_BIN ?? "claude";

  const result = await run({
    bin,
    args,
    cwd: process.cwd(),
    onReady: ({ session }) => {
      // The agent owns the terminal from here on, so this is the last thing
      // printed until it exits. Anything written while it runs would land in
      // the middle of its interface.
      console.log("");
      console.log(
        dim(`[llmlogger] recording ${session.project}/${session.id} — view with: llmlogger ui`)
      );
      console.log("");
    },
  });

  const { totals } = result;
  const inputTotal =
    totals.inputTokens + totals.cacheCreationTokens + totals.cacheReadTokens;
  const cacheShare = inputTotal ? (totals.cacheReadTokens / inputTotal) * 100 : 0;

  const rule = dim("─".repeat(64));
  const row = (label: string, value: string | number): void =>
    console.log(`  ${dim(label.padEnd(22))} ${value}`);

  console.log("");
  console.log(rule);
  console.log(`  ${bold("llmlogger")} ${dim(`${result.session.project}/${result.session.id}`)}`);
  console.log(rule);
  row("Generation calls", totals.generations);
  row("Token-count calls", `${totals.countTokenCalls} ${dim("(forwarded, not recorded)")}`);
  if (totals.errors) row("Errors", totals.errors);
  row("Request bytes", `${(totals.requestBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(rule);
  row("Fresh input", totals.inputTokens.toLocaleString());
  row("Cache writes", totals.cacheCreationTokens.toLocaleString());
  row("Cache reads", totals.cacheReadTokens.toLocaleString());
  row("Input total", `${inputTotal.toLocaleString()} ${dim(`(${cacheShare.toFixed(0)}% cached)`)}`);
  row("Output", totals.outputTokens.toLocaleString());
  console.log(rule);
  console.log(`  ${dim("Browse it:")} ${bold("llmlogger ui")}`);
  console.log("");

  return result.exitCode;
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

async function commandUi(args: string[]): Promise<number> {
  const portIndex = args.findIndex((a) => a === "--port" || a === "-p");
  const requested = portIndex === -1 ? DEFAULT_UI_PORT : Number(args[portIndex + 1]);
  if (!Number.isInteger(requested) || requested < 0 || requested > 65535) {
    console.error("--port needs a number between 0 and 65535");
    return 1;
  }

  let handle;
  try {
    handle = await startServer(requested);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      // The usual cause is a viewer that is already open, which is not an
      // error worth a stack trace.
      console.error(
        `Port ${requested} is already in use — a viewer may already be running at http://127.0.0.1:${requested}`
      );
      console.error(dim("Use a different one with: llmlogger ui --port 4848"));
      return 1;
    }
    throw err;
  }

  const url = `http://127.0.0.1:${handle.port}`;
  console.log("");
  console.log(`  ${green("●")} ${bold("llmlogger")} viewer on ${bold(url)}`);
  console.log(`  ${dim(`recordings in ${home()}`)}`);
  console.log(`  ${dim("Ctrl+C to stop")}`);
  console.log("");

  if (!args.includes("--no-open")) openBrowser(url);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      void handle.close().then(resolve);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

/** Open a URL in the desktop browser, silently doing nothing if it fails. */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Printing the URL above is enough.
  }
}

// ---------------------------------------------------------------------------
// Listing and deleting
// ---------------------------------------------------------------------------

function commandList(): number {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("No recordings yet. Start one with: llmlogger");
    return 0;
  }
  console.log("");
  for (const session of sessions) {
    const mb = (session.totalBytes / 1024 / 1024).toFixed(1);
    const marker = session.live ? green("●") : " ";
    console.log(
      `  ${marker} ${bold(session.project.padEnd(22))} ${session.id}  ` +
        dim(`${String(session.calls).padStart(4)} calls  ${mb.padStart(6)} MB  ` +
          `${session.outputTokens.toLocaleString()} out`)
    );
  }
  console.log("");
  console.log(dim("  Browse them: llmlogger ui"));
  console.log("");
  return 0;
}

function commandRemove(args: string[]): number {
  if (args.includes("--all")) {
    deleteAllSessions();
    console.log("All recordings deleted.");
    return 0;
  }

  const id = args[0];
  if (!id) {
    console.error("Which recording? Pass a session id, or --all.");
    console.error(dim("List them with: llmlogger ls"));
    return 1;
  }

  // An id is unique enough on its own in practice, so the project does not
  // have to be typed. Matching on a prefix lets a shortened id be used.
  const matches = listSessions().filter(
    (s) => s.id === id || s.id.startsWith(id) || `${s.project}/${s.id}` === id
  );

  if (matches.length === 0) {
    console.error(`No recording matches "${id}".`);
    return 1;
  }
  if (matches.length > 1) {
    console.error(`"${id}" matches ${matches.length} recordings:`);
    for (const match of matches) console.error(`  ${match.project}/${match.id}`);
    console.error("Use the full project/id form.");
    return 1;
  }

  const match = matches[0]!;
  deleteSession(match.project, match.id);
  console.log(`Deleted ${match.project}/${match.id}.`);
  return 0;
}

async function version(): Promise<string> {
  try {
    const pkg = await import("node:fs").then((fs) =>
      JSON.parse(
        fs.readFileSync(
          new URL("../package.json", import.meta.url),
          "utf8"
        )
      )
    );
    return String(pkg.version ?? "unknown");
  } catch {
    return "unknown";
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    console.error(`llmlogger: ${err.message}`);
    process.exit(1);
  });
