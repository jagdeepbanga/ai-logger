/**
 * One call, in full.
 *
 * The tabs follow the order the model reads them in — system prompt, tools,
 * messages, then what it produced — with an overview first that names the
 * sizes, so the reader can decide which section is worth opening.
 */

import { useEffect, useMemo, useState } from "react";
import type { CallDetail as Detail } from "../../../src/types";
import { rawUrl } from "../api";
import { bytes, clock, duration, num, pct, shortModel } from "../format";
import {
  Button,
  Chip,
  CopyButton,
  Panel,
  PanelHeader,
  ProportionBar,
  SECTION,
  Stat,
} from "./primitives";
import { MessageView } from "./MessageView";
import { TextPane } from "./TextPane";
import { systemTextOf } from "../derive";

type Tab = "overview" | "system" | "tools" | "messages" | "response" | "raw";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "system", label: "System prompt" },
  { id: "tools", label: "Tools" },
  { id: "messages", label: "Messages" },
  { id: "response", label: "Response" },
  { id: "raw", label: "Raw" },
];

export function CallDetail({
  detail,
  project,
  sessionId,
  onBack,
  onStep,
}: {
  detail: Detail;
  project: string;
  sessionId: string;
  onBack: () => void;
  onStep: (delta: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const { summary, request, response } = detail;

  // Arrow keys step through calls, which is how a session actually gets read:
  // find something odd in one call, then walk forwards to see it grow.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowLeft") onStep(-1);
      if (event.key === "ArrowRight") onStep(1);
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStep, onBack]);

  const systemText = useMemo(() => systemTextOf(request?.system), [request]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Button onClick={onBack}>← Session</Button>
        <Button onClick={() => onStep(-1)} title="Previous call (←)">
          ←
        </Button>
        <Button onClick={() => onStep(1)} title="Next call (→)">
          →
        </Button>
        <h1 className="ml-1 text-sm font-semibold">
          Call {summary.n}
          <span className="ml-2 font-normal text-zinc-500">{shortModel(summary.model)}</span>
        </h1>
        <span className="font-mono text-xs text-zinc-500">
          {clock(summary.time)} · {duration(summary.durationMs)} ·{" "}
          <span className={summary.status >= 400 ? "text-rose-500" : ""}>{summary.status}</span>
        </span>
        <div className="ml-auto flex gap-2">
          <a
            href={rawUrl(project, sessionId, summary.n, "request")}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            request.json
          </a>
          <a
            href={rawUrl(project, sessionId, summary.n, "response")}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            response.txt
          </a>
        </div>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 px-3 dark:border-zinc-800">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
              tab === entry.id
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {entry.label}
            {entry.id === "system" && (
              <span className="ml-1.5 font-mono text-[10px] text-zinc-400">
                {bytes(summary.systemBytes)}
              </span>
            )}
            {entry.id === "tools" && (
              <span className="ml-1.5 font-mono text-[10px] text-zinc-400">
                {summary.toolCount}
              </span>
            )}
            {entry.id === "messages" && (
              <span className="ml-1.5 font-mono text-[10px] text-zinc-400">
                {summary.messageCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "overview" && <Overview detail={detail} />}
        {tab === "system" && (
          <TextPane text={systemText} emptyLabel="This request carried no system prompt." />
        )}
        {tab === "tools" && <Tools detail={detail} />}
        {tab === "messages" && (
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find in the conversation…"
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <MessageView messages={request?.messages ?? []} query={query} />
          </div>
        )}
        {tab === "response" && <Response detail={detail} />}
        {tab === "raw" && <TextPane text={detail.requestRaw} />}
      </div>
    </div>
  );
}

function Overview({ detail }: { detail: Detail }) {
  const { summary, response, headers } = detail;
  const inputTotal =
    (summary.usage.input_tokens ?? 0) +
    (summary.usage.cache_creation_input_tokens ?? 0) +
    (summary.usage.cache_read_input_tokens ?? 0);

  return (
    <div className="space-y-5 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sent upstream" value={bytes(summary.totalBytes)} sub={`${summary.cacheBreakpoints} cache breakpoints`} />
        <Stat
          label="Input tokens"
          value={num(inputTotal)}
          sub={`${pct(summary.usage.cache_read_input_tokens ?? 0, inputTotal)} from cache`}
          accent="text-violet-600 dark:text-violet-400"
        />
        <Stat label="Output tokens" value={num(summary.usage.output_tokens)} sub={summary.stopReason ?? ""} />
        <Stat
          label="Fresh input"
          value={num((summary.usage.input_tokens ?? 0) + (summary.usage.cache_creation_input_tokens ?? 0))}
          sub="charged at full rate"
          accent="text-rose-600 dark:text-rose-400"
        />
      </div>

      <Panel>
        <PanelHeader title="Request breakdown" />
        <div className="space-y-3 p-4">
          <ProportionBar
            parts={[
              { value: summary.systemBytes, className: SECTION.system.bg, label: "System" },
              { value: summary.toolBytes, className: SECTION.tools.bg, label: "Tools" },
              { value: summary.messageBytes, className: SECTION.messages.bg, label: "Messages" },
            ]}
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <Row label="System prompt" value={`${bytes(summary.systemBytes)} · ${num(summary.systemChars)} chars`} className={SECTION.system.text} />
            <Row label="Tool schemas" value={`${bytes(summary.toolBytes)} · ${summary.toolCount} tools`} className={SECTION.tools.text} />
            <Row label="Messages" value={`${bytes(summary.messageBytes)} · ${summary.messageCount} turns`} className={SECTION.messages.text} />
            <Row label="Model" value={summary.model} />
            <Row label="Max tokens" value={num(summary.maxTokens)} />
            <Row label="Streamed" value={summary.stream ? "yes" : "no"} />
          </dl>
        </div>
      </Panel>

      {summary.skills.length > 0 && (
        <Panel>
          <PanelHeader
            title="Skills advertised"
            hint={`${summary.skills.length} listed to the model on this call`}
          />
          <div className="flex flex-wrap gap-1.5 p-4">
            {summary.skills.map((skill) => (
              <Chip key={skill} tone="blue">
                {skill}
              </Chip>
            ))}
          </div>
        </Panel>
      )}

      {response.toolCalls.length > 0 && (
        <Panel>
          <PanelHeader title="Tools the model called" />
          <div className="flex flex-wrap gap-1.5 p-4">
            {response.toolCalls.map((call, index) => (
              <Chip key={index} tone="violet">
                {call.name}
              </Chip>
            ))}
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Request headers"
          hint="Credentials are replaced before anything is written to disk"
        />
        <div className="overflow-x-auto p-4">
          <table className="text-xs">
            <tbody className="font-mono">
              {Object.entries(headers).map(([key, value]) => (
                <tr key={key}>
                  <td className="pr-4 align-top text-zinc-500 whitespace-nowrap">{key}</td>
                  <td className="break-all">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Row({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <dt className={`font-medium ${className || "text-zinc-500"}`}>{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function Tools({ detail }: { detail: Detail }) {
  const [open, setOpen] = useState<string | null>(null);
  const { summary, request } = detail;
  const definitions = new Map(
    (request?.tools ?? []).map((tool) => [tool.name ?? "", tool] as const)
  );
  const total = summary.tools.reduce((sum, tool) => sum + tool.bytes, 0) || 1;

  if (summary.tools.length === 0) {
    return <p className="p-6 text-sm text-zinc-500">This request carried no tool definitions.</p>;
  }

  return (
    <div className="p-4">
      <p className="mb-3 text-xs text-zinc-500">
        {summary.toolCount} tools, {bytes(total)} in total, {summary.mcpToolCount} from MCP
        servers. Largest first — this is where a bloated context usually comes from.
      </p>
      <div className="space-y-1.5">
        {summary.tools.map((tool) => (
          <div key={tool.name} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setOpen(open === tool.name ? null : tool.name)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            >
              <span className="text-zinc-400">{open === tool.name ? "▾" : "▸"}</span>
              <span className="font-mono text-xs font-medium">{tool.name}</span>
              {tool.mcp && <Chip tone="emerald">mcp</Chip>}
              <span className="ml-auto flex items-center gap-2">
                <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 sm:block dark:bg-zinc-800">
                  <span
                    className="block h-full bg-amber-500"
                    style={{ width: `${(tool.bytes / total) * 100}%` }}
                  />
                </span>
                <span className="w-16 text-right font-mono text-xs tabular-nums text-zinc-500">
                  {bytes(tool.bytes)}
                </span>
              </span>
            </button>
            {open === tool.name && (
              <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-2 flex justify-end">
                  <CopyButton text={JSON.stringify(definitions.get(tool.name), null, 2)} />
                </div>
                <pre className="prompt-text max-h-96 overflow-auto">
                  {JSON.stringify(definitions.get(tool.name), null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Response({ detail }: { detail: Detail }) {
  const { response } = detail;

  if (response.error) {
    return (
      <div className="p-5">
        <Panel className="border-rose-300 dark:border-rose-900">
          <PanelHeader title="The upstream returned an error" />
          <pre className="prompt-text p-4 text-rose-700 dark:text-rose-300">{response.error}</pre>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-5">
      {response.thinking && (
        <Panel>
          <PanelHeader
            title="Thinking"
            hint={`${response.thinking.length.toLocaleString()} chars`}
            right={<CopyButton text={response.thinking} />}
          />
          <pre className="prompt-text max-h-[28rem] overflow-auto p-4 text-violet-800 dark:text-violet-300">
            {response.thinking}
          </pre>
        </Panel>
      )}

      {response.text && (
        <Panel>
          <PanelHeader
            title="Text"
            hint={`${response.text.length.toLocaleString()} chars`}
            right={<CopyButton text={response.text} />}
          />
          <pre className="prompt-text p-4">{response.text}</pre>
        </Panel>
      )}

      {response.toolCalls.map((call, index) => (
        <Panel key={index}>
          <PanelHeader title={`Tool call → ${call.name}`} />
          <pre className="prompt-text max-h-96 overflow-auto p-4">
            {JSON.stringify(call.input, null, 2)}
          </pre>
        </Panel>
      ))}

      {!response.text && !response.thinking && response.toolCalls.length === 0 && (
        <p className="text-sm text-zinc-500">
          This response carried no content — check the Raw tab for the bytes as they arrived.
        </p>
      )}
    </div>
  );
}
