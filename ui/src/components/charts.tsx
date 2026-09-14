/**
 * Charts, drawn as inline SVG.
 *
 * A chart library would be a runtime dependency for two chart types, and the
 * point of this package is that the installed tool has none. These are small
 * enough to own.
 */

import { useState } from "react";
import type { CallSummary } from "../../../src/types";
import { bytes, num } from "../format";
import { SECTION } from "./primitives";

interface HoverState {
  index: number;
  x: number;
  y: number;
}

/**
 * One column per call, stacked by request section.
 *
 * This is the chart that answers "what is actually filling my context" at a
 * glance: a tall amber block means tool schemas dominate, a growing green one
 * means the conversation is.
 */
export function RequestSizeChart({
  calls,
  onSelect,
  selected,
}: {
  calls: CallSummary[];
  onSelect: (n: number) => void;
  selected?: number;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const height = 150;
  const gap = 2;
  // Columns share the full width, so a session with 4 calls and one with 400
  // both fill the panel instead of leaving it half empty or overflowing.
  const width = 100;
  const columnWidth = Math.max(0.4, width / Math.max(calls.length, 1) - gap / 10);
  const max = Math.max(...calls.map((c) => c.totalBytes), 1);

  const hovered = hover ? calls[hover.index] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[150px] w-full"
        role="img"
        aria-label="Request size per call, split by section"
      >
        {calls.map((call, index) => {
          const x = (index * width) / calls.length;
          const scale = (value: number): number => (value / max) * (height - 8);
          const sys = scale(call.systemBytes);
          const tools = scale(call.toolBytes);
          const msgs = scale(call.messageBytes);
          // Anything not accounted for by the three named sections — metadata,
          // sampling options — is drawn as a neutral remainder rather than
          // silently dropped, so the column height always means total bytes.
          const other = Math.max(0, scale(call.totalBytes) - sys - tools - msgs);
          const isSelected = selected === call.n;

          let y = height;
          const block = (value: number, fill: string, key: string) => {
            y -= value;
            return (
              <rect
                key={key}
                x={x}
                y={y}
                width={columnWidth}
                height={value}
                fill={fill}
                opacity={isSelected || hover?.index === index ? 1 : 0.82}
              />
            );
          };

          return (
            <g
              key={call.n}
              onMouseEnter={(event) =>
                setHover({
                  index,
                  x: event.nativeEvent.offsetX,
                  y: event.nativeEvent.offsetY,
                })
              }
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(call.n)}
              className="cursor-pointer"
            >
              {/* An invisible full-height target keeps short columns clickable. */}
              <rect x={x} y={0} width={columnWidth} height={height} fill="transparent" />
              {block(msgs, SECTION.messages.fill, "m")}
              {block(tools, SECTION.tools.fill, "t")}
              {block(sys, SECTION.system.fill, "s")}
              {block(other, "#a1a1aa", "o")}
            </g>
          );
        })}
      </svg>

      {hovered && hover && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{
            left: Math.min(hover.x + 12, 320),
            top: 4,
          }}
        >
          <div className="mb-1.5 font-semibold">
            Call {hovered.n} · {bytes(hovered.totalBytes)}
          </div>
          <Row label={SECTION.system.label} value={bytes(hovered.systemBytes)} dot={SECTION.system.bg} />
          <Row label={SECTION.tools.label} value={bytes(hovered.toolBytes)} dot={SECTION.tools.bg} />
          <Row label={SECTION.messages.label} value={bytes(hovered.messageBytes)} dot={SECTION.messages.bg} />
          <div className="mt-1.5 border-t border-zinc-200 pt-1.5 text-zinc-500 dark:border-zinc-700">
            {num(hovered.usage.output_tokens)} output tokens
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
        <span className={`size-2 rounded-sm ${dot}`} />
        {label}
      </span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Input tokens per call, separating what was paid for fresh from what the
 * cache served. The gap between the two lines is the saving, which is the
 * number worth watching across a long session.
 */
export function TokenChart({ calls }: { calls: CallSummary[] }) {
  const height = 150;
  const width = 100;
  const values = calls.map((call) => ({
    fresh: (call.usage.input_tokens ?? 0) + (call.usage.cache_creation_input_tokens ?? 0),
    cached: call.usage.cache_read_input_tokens ?? 0,
  }));
  const max = Math.max(...values.map((v) => Math.max(v.fresh, v.cached)), 1);

  const line = (pick: (v: { fresh: number; cached: number }) => number): string =>
    values
      .map((value, index) => {
        const x = calls.length === 1 ? width / 2 : (index / (calls.length - 1)) * width;
        const y = height - (pick(value) / max) * (height - 8) - 4;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const area = (pick: (v: { fresh: number; cached: number }) => number): string =>
    `${line(pick)} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-[150px] w-full"
      role="img"
      aria-label="Input tokens per call, fresh against cache reads"
    >
      <path d={area((v) => v.cached)} fill="#8b5cf6" opacity={0.18} />
      <path
        d={line((v) => v.cached)}
        fill="none"
        stroke="#8b5cf6"
        strokeWidth={0.7}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={line((v) => v.fresh)}
        fill="none"
        stroke="#f43f5e"
        strokeWidth={0.7}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Legend({ items }: { items: Array<{ label: string; className: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`size-2 rounded-sm ${item.className}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
