# llmlogger

See exactly what Claude Code sends to the model — the real system prompt, every
tool schema, the whole conversation, the skills it advertised, and what it cost
— in a local web UI.

```
llmlogger          # instead of `claude`
llmlogger ui       # browse what it recorded
```

Works in any project, in any language. Nothing is written into your repo.

---

## Why

Claude Code's context bar tells you a number. It does not tell you *what*
filled it. A single turn can carry 90 KB of request, and in a typical session
**the tool schemas are bigger than the system prompt and the conversation put
together** — a fact that is invisible until you look at the bytes.

`llmlogger` makes it visible:

- **What went in** — the verbatim system prompt, every tool definition ranked
  by size, the full message history with a byte cost on each block.
- **What came back** — text, thinking, and the tool calls the model asked for.
- **What it cost** — fresh input against cache reads, per call and per session.
- **Which skills were offered** — the list the model actually saw, not the list
  you think is installed.

## How it works

Claude Code reads `ANTHROPIC_BASE_URL` to decide where to send requests.
`llmlogger` starts a proxy on a loopback port, launches Claude Code with that
variable already set, forwards every request upstream untouched — your auth
header included, so a subscription login keeps working — and streams responses
straight back as they arrive. The agent behaves exactly as it would without it.
Only a copy is kept.

```
llmlogger
  └─ proxy on 127.0.0.1:<free port>
     └─ spawns: claude   (ANTHROPIC_BASE_URL=…, ENABLE_TOOL_SEARCH=true)
        │
        └─ request → api.anthropic.com → response
                        ↓ a copy
                  ~/.llmlogger/sessions/<project>/<session>/
```

Launching the agent rather than asking you to export a variable removes the
usual failure mode: an agent reads that variable once, at startup, so getting
the order wrong records nothing and looks identical to a broken tool.

## Install

Requires Node 20 or newer, and `claude` on your `PATH`.

```bash
git clone https://github.com/<you>/llmlogger.git
cd llmlogger
npm install          # also builds, via the prepare script
npm link             # puts `llmlogger` on your PATH
```

If `npm link` fails with `EACCES`, your npm prefix needs root. Symlink it into
a directory you own instead:

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/dist/cli.js" ~/.local/bin/llmlogger
# make sure ~/.local/bin is on your PATH
```

## Use

```bash
cd ~/code/my-laravel-app
llmlogger                       # record a session; work exactly as normal
```

Every `claude` flag passes straight through:

```bash
llmlogger --resume
llmlogger --model claude-opus-5
llmlogger -p "explain the User model"
```

When the session ends you get a summary. Then:

```bash
llmlogger ui                    # open the viewer (http://127.0.0.1:4747)
llmlogger ui --port 4848        # somewhere else
llmlogger ls                    # list recordings from the terminal
llmlogger rm 2026-09-14T12-38   # delete one
llmlogger rm --all              # delete everything
llmlogger where                 # print the recordings directory
```

The viewer streams: leave `llmlogger ui` open in a tab while you work and calls
appear as the agent makes them, with a live marker on the session.

## The UI

**Session overview** — totals, a stacked column per call split by section
(click a column to open that call), fresh input against cache reads over time,
and where the bytes went across the whole session.

**Call detail** — six tabs:

| Tab | What it answers |
| --- | --- |
| Overview | Sizes, cache breakpoints, usage, skills advertised, request headers |
| System prompt | The verbatim prompt, searchable |
| Tools | Every schema, **ranked largest first** — where bloat comes from |
| Messages | The conversation by content block, each with its byte cost |
| Response | Text, thinking, and tool calls |
| Raw | The request body exactly as sent |

`←` and `→` step between calls; `Esc` goes back to the session.

## Two things that will otherwise confuse you

**One message is not one request.** A turn fans out into one real generation
call plus several `count_tokens` calls that measure sizes for the context bar,
caching and compaction. Those are forwarded but not recorded — otherwise they
would bury every real turn. The summary counts them, so the fan-out stays
visible.

**Watching changes the thing watched.** Claude Code trusts exactly one host.
Pointed anywhere else it turns off tool search, stops deferring tool schemas,
and inlines every one of them — the recording would be far larger than a real
request and the wrong shape. `llmlogger` sets `ENABLE_TOOL_SEARCH=true` to cancel
that, so what you read is what Claude Code really sends.

## Where recordings live

`~/.llmlogger/sessions/<project>/<session>/`, outside your project — so there is
nothing to gitignore and no chance of committing prompts and source code.
Override with `LLMLOGGER_HOME`.

Plain files, so a recording is useful without this tool:

```
session.json                what and where
index.jsonl                 one line of metrics per call  (jq-friendly)
calls/0001/request.json     the decoded request body, as sent
           response.txt     the raw response stream
           headers.json     request headers, credentials replaced
```

## Security

`authorization`, `x-api-key`, `api-key`, `cookie` and `proxy-authorization`
are replaced with `<redacted>` before anything touches disk — the real values
are never written. The viewer binds to loopback only.

Everything else is verbatim, so a recording contains your prompts, your source
code and any file the agent read. Treat `~/.llmlogger` as sensitive as the projects
it records, and use `llmlogger rm --all` when you are done with it.

## Other agents

The recorder is Anthropic-shaped: it reads the Messages API wire format and
sets `ANTHROPIC_BASE_URL`. Point it at a gateway or a local server with
`LLMLOGGER_UPSTREAM=http://127.0.0.1:9000`, and override the launched binary with
`LLMLOGGER_AGENT_BIN`.

Some tools cannot be recorded by anything, and this is worth knowing: a few
vendors build the system prompt **on their servers**, so your machine never
sends it. No proxy can read what never goes past your network card. That is a
property of those products, not a limit of this one.

## Develop

```bash
npm test             # 80 tests, including the proxy end to end
npm run typecheck    # server and UI
npm run build        # dist/cli.js + dist/ui
npm run dev          # UI with hot reload; run `llmlogger ui` alongside for data
```

The end-to-end test drives the real proxy against a fake upstream with a
stand-in agent, so it needs no network and no API key.

| File | Role |
| --- | --- |
| `src/recorder.ts` | The proxy, and launching the agent |
| `src/capture.ts` | Measuring requests, rebuilding responses — all pure |
| `src/store.ts` | Reading and writing recordings |
| `src/server.ts` | JSON API, static UI, live events |
| `src/cli.ts` | The `llmlogger` command |
| `ui/` | The viewer (React, built into `dist/ui`) |

The installed package has **no runtime dependencies** — React is bundled at
build time, and the server is Node built-ins.

## Credit

The idea of proxying a coding agent to read its prompts comes from Matt
Pocock's AI Coding Crash Course, which includes a multi-agent `request-logger`
that writes Markdown captures. `llmlogger` narrows the scope to Claude Code and
adds a UI, a metrics index and live streaming.

## License

MIT
