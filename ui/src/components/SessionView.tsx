/**
 * A whole recorded session: the totals, the two charts, and the list of calls.
 */

import { useMemo } from "react";
import type { CallSummary, SessionMeta } from "../../../src/types";
import { bytes, clock, duration, num, pct, sessionLabel, shortModel } from "../format";
import { Legend, RequestSizeChart, TokenChart } from "./charts";
import {
  Chip,
  Empty,
  Panel,
  PanelHeader,
  ProportionBar,
  SECTION,
  Stat,
} from "./primitives";

export function SessionView({
  meta,
  calls,
  onOpenCall,
  live,
}: {
  meta: SessionMeta;
  calls: CallSummary[];
  onOpenCall: (n: number) => void;
  live: boolean;
}) {
  const totals = useMemo(() => summarise(calls), [calls]);

  if (calls.length === 0) {
    return (
      <div className="p-6">
        <Header meta={meta} live={live} />
        <Panel className="mt-6">
          <Empty
            title={live ? "Waiting for the first request…" : "No requests were recorded"}
            hint={
              live ? (
                "Calls appear here as the agent makes them."
              ) : (
                <>
                  A session with no calls usually means the agent exited before
                  its first turn. Token-counting calls are forwarded but never
                  recorded, so a session used only for housekeeping stays empty.
                </>
              )
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Header meta={meta} live={live} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Calls" value={num(calls.length)} sub={`${num(totals.errors)} failed`} />
        <Stat
          label="Sent upstream"
          value={bytes(totals.totalBytes)}
          sub={`${bytes(Math.round(totals.totalBytes / calls.length))} per call`}
        />
        <Stat
          label="Input tokens"
          value={num(totals.inputTotal)}
          sub={`${pct(totals.cacheRead, totals.inputTotal)} served from cache`}
          accent="text-violet-600 dark:text-violet-400"
        />
        <Stat
          label="Fresh input"
          value={num(totals.fresh)}
          sub="not served from cache"
          accent="text-rose-600 dark:text-rose-400"
        />
        <Stat label="Output tokens" value={num(totals.output)} sub={`${num(totals.thinking)} chars thinking`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Request size per call"
            hint="Click a column to open that call"
            right={
              <Legend
                items={[
                  { label: "System", className: SECTION.system.bg },
                  { label: "Tools", className: SECTION.tools.bg },
                  { label: "Messages", className: SECTION.messages.bg },
                ]}
              />
            }
          />
          <div className="p-3">
            <RequestSizeChart calls={calls} onSelect={onOpenCall} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Input tokens per call"
            hint="The gap between the lines is what caching saved"
            right={
              <Legend
                items={[
                  { label: "Fresh + cache writes", className: "bg-rose-500" },
                  { label: "Cache reads", className: "bg-violet-500" },
                ]}
              />
            }
          />
          <div className="p-3">
            <TokenChart calls={calls} />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Where the bytes went"
          hint="Totals across every call in this session"
        />
        <div className="space-y-3 p-4">
          <ProportionBar
            parts={[
              { value: totals.systemBytes, className: SECTION.system.bg, label: "System" },
              { value: totals.toolBytes, className: SECTION.tools.bg, label: "Tools" },
              { value: totals.messageBytes, className: SECTION.messages.bg, label: "Messages" },
            ]}
          />
          <div className="grid grid-cols-3 gap-4 text-xs">
            <SectionTotal
              label={SECTION.system.label}
              className={SECTION.system.text}
              value={totals.systemBytes}
              whole={totals.totalBytes}
            />
            <SectionTotal
              label={SECTION.tools.label}
              className={SECTION.tools.text}
              value={totals.toolBytes}
              whole={totals.totalBytes}
            />
            <SectionTotal
              label={SECTION.messages.label}
              className={SECTION.messages.text}
              value={totals.messageBytes}
              whole={totals.totalBytes}
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Calls" hint={`${calls.length} recorded`} />
        <CallTable calls={calls} onOpenCall={onOpenCall} />
      </Panel>
    </div>
  );
}

function Header({ meta, live }: { meta: SessionMeta; live: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-lg font-semibold">{meta.project}</h1>
      <span className="font-mono text-sm text-zinc-500">{sessionLabel(meta.id)}</span>
      {live && (
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          recording
        </span>
      )}
      {meta.cwd && (
        <span className="font-mono text-xs text-zinc-400" title={meta.cwd}>
          {meta.cwd}
        </span>
      )}
      {meta.args.length > 0 && (
        <Chip title="Arguments passed to claude">claude {meta.args.join(" ")}</Chip>
      )}
    </div>
  );
}

function SectionTotal({
  label,
  className,
  value,
  whole,
}: {
  label: string;
  className: string;
  value: number;
  whole: number;
}) {
  return (
    <div>
      <div className={`font-medium ${className}`}>{label}</div>
      <div className="mt-0.5 font-mono tabular-nums">
        {bytes(value)} <span className="text-zinc-500">· {pct(value, whole)}</span>
      </div>
    </div>
  );
}

export function CallTable({
  calls,
  onOpenCall,
}: {
  calls: CallSummary[];
  onOpenCall: (n: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <Th className="w-12">#</Th>
            <Th className="w-20">Time</Th>
            <Th>Model</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">System</Th>
            <Th className="text-right">Tools</Th>
            <Th className="text-right">Messages</Th>
            <Th className="text-right">In</Th>
            <Th className="text-right">Cached</Th>
            <Th className="text-right">Out</Th>
            <Th className="text-right">Took</Th>
            <Th>Called</Th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {calls.map((call) => (
            <tr
              key={call.n}
              onClick={() => onOpenCall(call.n)}
              className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
            >
              <Td className="text-zinc-400">{call.n}</Td>
              <Td>{clock(call.time)}</Td>
              <Td className="font-sans">
                {shortModel(call.model)}
                {call.status >= 400 && (
                  <span className="ml-2 text-rose-600 dark:text-rose-400">{call.status}</span>
                )}
              </Td>
              <Td className="text-right font-semibold">{bytes(call.totalBytes)}</Td>
              <Td className={`text-right ${SECTION.system.text}`}>{bytes(call.systemBytes)}</Td>
              <Td className={`text-right ${SECTION.tools.text}`}>{bytes(call.toolBytes)}</Td>
              <Td className={`text-right ${SECTION.messages.text}`}>{bytes(call.messageBytes)}</Td>
              <Td className="text-right">{num(call.usage.input_tokens)}</Td>
              <Td className="text-right text-violet-600 dark:text-violet-400">
                {num(call.usage.cache_read_input_tokens)}
              </Td>
              <Td className="text-right">{num(call.usage.output_tokens)}</Td>
              <Td className="text-right text-zinc-500">{duration(call.durationMs)}</Td>
              <Td className="font-sans">
                <span className="flex flex-wrap gap-1">
                  {[...new Set(call.toolsCalled)].slice(0, 4).map((tool) => (
                    <Chip key={tool} tone="violet">
                      {tool}
                    </Chip>
                  ))}
                  {call.toolsCalled.length === 0 && <span className="text-zinc-400">—</span>}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 font-medium whitespace-nowrap ${className}`}>{children}</th>
  );
}

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-1.5 whitespace-nowrap ${className}`}>{children}</td>;
}

function summarise(calls: CallSummary[]) {
  const totals = {
    totalBytes: 0,
    systemBytes: 0,
    toolBytes: 0,
    messageBytes: 0,
    fresh: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
    errors: 0,
    inputTotal: 0,
  };
  for (const call of calls) {
    totals.totalBytes += call.totalBytes;
    totals.systemBytes += call.systemBytes;
    totals.toolBytes += call.toolBytes;
    totals.messageBytes += call.messageBytes;
    totals.fresh +=
      (call.usage.input_tokens ?? 0) + (call.usage.cache_creation_input_tokens ?? 0);
    totals.cacheRead += call.usage.cache_read_input_tokens ?? 0;
    totals.output += call.usage.output_tokens ?? 0;
    totals.thinking += call.thinkingChars;
    if (call.status >= 400) totals.errors++;
  }
  totals.inputTotal = totals.fresh + totals.cacheRead;
  return totals;
}
