/**
 * The conversation as the model received it.
 *
 * Each turn is shown as its content blocks, because that is the unit the API
 * works in and the unit that explains size: a single tool result can be most
 * of a request. Blocks start collapsed past a threshold so a long history
 * stays navigable, and each one shows its own byte cost.
 */

import { useState } from "react";
import type { ContentBlock, Message } from "../../../src/types";
import { bytes } from "../format";
import { Chip } from "./primitives";
import { Highlight } from "./TextPane";

const COLLAPSE_OVER = 1500;

export function MessageView({
  messages,
  query,
}: {
  messages: Message[];
  query: string;
}) {
  if (messages.length === 0) {
    return <p className="p-6 text-sm text-zinc-500">This request carried no messages.</p>;
  }
  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {messages.map((message, index) => (
        <Turn key={index} index={index} message={message} query={query} />
      ))}
    </div>
  );
}

function Turn({
  message,
  index,
  query,
}: {
  message: Message;
  index: number;
  query: string;
}) {
  const blocks: ContentBlock[] =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : (message.content ?? []);

  const isUser = message.role === "user";

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[11px] text-zinc-400">{index}</span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            isUser
              ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {message.role}
        </span>
        <span className="text-[11px] text-zinc-500">
          {blocks.length} block{blocks.length === 1 ? "" : "s"} ·{" "}
          {bytes(new Blob([JSON.stringify(message)]).size)}
        </span>
      </div>
      <div className="space-y-2">
        {blocks.map((block, blockIndex) => (
          <Block key={blockIndex} block={block} query={query} />
        ))}
      </div>
    </div>
  );
}

function Block({ block, query }: { block: ContentBlock; query: string }) {
  const type = block.type ?? "unknown";

  if (type === "text" || type === "thinking") {
    const text = (type === "text" ? block.text : block.thinking) ?? "";
    return (
      <Collapsible
        label={type}
        tone={type === "thinking" ? "violet" : "neutral"}
        size={text.length}
        cached={Boolean(block.cache_control)}
      >
        <div className="prompt-text">
          <Highlight text={text} query={query} />
        </div>
      </Collapsible>
    );
  }

  if (type === "tool_use") {
    return (
      <Collapsible
        label={`tool_use → ${block.name ?? "?"}`}
        tone="amber"
        size={JSON.stringify(block.input ?? {}).length}
        cached={Boolean(block.cache_control)}
      >
        <pre className="prompt-text">{JSON.stringify(block.input, null, 2)}</pre>
      </Collapsible>
    );
  }

  if (type === "tool_result") {
    const text =
      typeof block.content === "string"
        ? block.content
        : (block.content ?? [])
            .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
            .join("\n");
    return (
      <Collapsible
        label="tool_result"
        tone={block.is_error ? "red" : "emerald"}
        size={text.length}
        cached={Boolean(block.cache_control)}
      >
        <div className="prompt-text">
          <Highlight text={text} query={query} />
        </div>
      </Collapsible>
    );
  }

  return (
    <Collapsible label={type} tone="neutral" size={JSON.stringify(block).length} cached={false}>
      <pre className="prompt-text">{JSON.stringify(block, null, 2)}</pre>
    </Collapsible>
  );
}

function Collapsible({
  label,
  tone,
  size,
  cached,
  children,
}: {
  label: string;
  tone: "neutral" | "amber" | "emerald" | "violet" | "red";
  size: number;
  cached: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(size <= COLLAPSE_OVER);

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
        <Chip tone={tone}>{label}</Chip>
        <span className="font-mono text-[11px] text-zinc-500">{bytes(size)}</span>
        {cached && (
          <span
            title="A cache breakpoint sits on this block"
            className="font-mono text-[11px] text-violet-500"
          >
            cache
          </span>
        )}
      </button>
      {open && <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">{children}</div>}
    </div>
  );
}
