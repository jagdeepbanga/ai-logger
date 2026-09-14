/**
 * Turning raw bytes into something worth reading.
 *
 * Two jobs, both pure so that they can be tested without a network or a
 * filesystem: measure what a request actually sent, and rebuild what the
 * response actually said.
 */

import zlib from "node:zlib";
import type {
  AnthropicRequest,
  CallSummary,
  ContentBlock,
  Message,
  ParsedResponse,
  ToolSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/**
 * Decode a request body for reading.
 *
 * Only the copy kept for display is decoded. The bytes forwarded upstream are
 * never touched, because the upstream must receive exactly what the agent
 * produced.
 */
export function decodeBody(body: Buffer, encoding?: string | string[]): string {
  if (body.length === 0) return "";
  const enc = Array.isArray(encoding) ? encoding[0] : encoding;
  try {
    if (enc === "gzip") return zlib.gunzipSync(body).toString("utf8");
    if (enc === "br") return zlib.brotliDecompressSync(body).toString("utf8");
    if (enc === "deflate") return zlib.inflateSync(body).toString("utf8");
  } catch {
    // A body that will not decode is still worth showing as text.
  }
  return body.toString("utf8");
}

const jsonBytes = (value: unknown): number =>
  value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value), "utf8");

/** System prompt text, whichever of the two shapes the API allows was used. */
export function systemText(system: AnthropicRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map((block) => block?.text ?? "").join("\n\n");
  }
  return "";
}

/**
 * The readable text inside a list of messages.
 *
 * Skills are advertised to the model in a system-reminder attached to a user
 * turn rather than in the system prompt, so finding them means reading the
 * message content too. Walking the blocks preserves the real newlines the
 * listing's line-per-skill format depends on; `JSON.stringify` would escape
 * them and no line-anchored pattern would ever match.
 */
export function messagesText(messages: Message[] | undefined): string {
  const parts: string[] = [];
  const walk = (content: Message["content"] | undefined): void => {
    if (typeof content === "string") {
      parts.push(content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (typeof block === "string") parts.push(block);
      else if (block?.type === "text") parts.push(block.text ?? "");
      else if (block?.type === "tool_result") walk(block.content as never);
    }
  };
  for (const message of messages ?? []) walk(message?.content);
  return parts.join("\n\n");
}

/**
 * The skills advertised to the model in this request.
 *
 * Skills arrive as a listing, one line per skill. Two forms appear: a skill
 * whose description was included reads `- name: description`, and one whose
 * description was dropped reads `- name` alone. Descriptions run to several
 * lines and start at column zero, so there is no reliable textual end to the
 * listing — bounding it by a blank-line-then-capital rule stops at the first
 * multi-line description and misses most of the list.
 *
 * The rule used instead is the shape of the name: a lowercase slug with an
 * optional `plugin:` prefix, alone on a line or followed by a colon. The
 * ordinary prose bullets elsewhere in the prompt start with a capital and so
 * never match, which means the pattern needs no guess about where the listing
 * ends. Text before the marker is ignored, so a bulleted list earlier in the
 * conversation cannot leak in.
 */
export function extractSkills(text: string): string[] {
  const names = new Set<string>();

  // An explicit tag is unambiguous wherever it appears.
  for (const m of text.matchAll(/<skill[^>]*name=["']([^"']+)["']/g)) {
    if (m[1]) names.add(m[1]);
  }

  const marker = text.lastIndexOf("skills are available");
  if (marker === -1) return [...names];

  const listing = text.slice(marker);
  const line =
    /^[-*][ \t]+([a-z][a-z0-9]*(?:[-.][a-z0-9]+)*(?::[a-z0-9]+(?:[-.][a-z0-9]+)*)?)(?::[ \t]|[ \t]*$)/gm;
  for (const m of listing.matchAll(line)) {
    if (m[1]) names.add(m[1]);
  }
  return [...names];
}

/** How many `cache_control` markers the request carries, at any depth. */
export function countCacheBreakpoints(value: unknown): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      if ((node as ContentBlock).cache_control) count++;
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return count;
}

/** Tool definitions reduced to name, size and origin, largest first. */
export function summariseTools(request: AnthropicRequest): ToolSummary[] {
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return tools
    .map((tool) => ({
      name: tool?.name ?? "(unnamed)",
      bytes: jsonBytes(tool),
      mcp: String(tool?.name ?? "").startsWith("mcp__"),
      description:
        typeof tool?.description === "string"
          ? tool.description.slice(0, 300)
          : undefined,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

export interface MeasureInput {
  n: number;
  time: string;
  durationMs: number;
  status: number;
  requestRaw: string;
  request: AnthropicRequest | null;
  response: ParsedResponse;
}

/** Everything `index.jsonl` records about one call. */
export function measure(input: MeasureInput): CallSummary {
  const request = input.request ?? {};
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const sysText = systemText(request.system);
  const tools = summariseTools(request);

  // Both halves are searched for skills: the system prompt may carry <skill>
  // tags, and the messages carry the system-reminder listing.
  const promptText = `${sysText}\n\n${messagesText(messages)}`;

  return {
    n: input.n,
    time: input.time,
    durationMs: input.durationMs,
    status: input.status,
    model: request.model ?? "unknown",
    stream: Boolean(request.stream),
    maxTokens: typeof request.max_tokens === "number" ? request.max_tokens : undefined,
    totalBytes: Buffer.byteLength(input.requestRaw, "utf8"),
    systemBytes: jsonBytes(request.system),
    toolBytes: jsonBytes(request.tools),
    messageBytes: jsonBytes(request.messages),
    systemChars: sysText.length,
    toolCount: tools.length,
    mcpToolCount: tools.filter((t) => t.mcp).length,
    messageCount: messages.length,
    cacheBreakpoints: countCacheBreakpoints(request),
    skills: extractSkills(promptText),
    tools,
    toolsCalled: input.response.toolCalls.map((c) => c.name),
    stopReason: input.response.stopReason,
    usage: input.response.usage ?? {},
    responseChars: input.response.text.length,
    thinkingChars: input.response.thinking.length,
    error: input.response.error,
  };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Rebuild a response into the pieces worth reading: the assistant text, any
 * thinking, the tool calls it asked for, and the usage numbers.
 *
 * Streamed and non-streamed bodies both arrive here. A streamed body is a
 * sequence of server-sent events whose deltas have to be reassembled; a
 * non-streamed one is a single JSON object. The leading character tells them
 * apart, with a fall-through in case a body starts with `{` and still is not
 * JSON.
 */
export function parseResponse(raw: string): ParsedResponse {
  const result: ParsedResponse = {
    text: "",
    thinking: "",
    toolCalls: [],
    usage: null,
    stopReason: null,
  };

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return parseWholeBody(JSON.parse(trimmed), result);
    } catch {
      // Not JSON after all; fall through to the event reader.
    }
  }
  return parseEventStream(raw, result);
}

function parseWholeBody(
  body: Record<string, unknown>,
  result: ParsedResponse
): ParsedResponse {
  if (body.type === "error" || body.error) {
    result.error = JSON.stringify(body.error ?? body);
    return result;
  }
  result.usage = (body.usage as ParsedResponse["usage"]) ?? null;
  result.stopReason = (body.stop_reason as string | null) ?? null;
  for (const block of (body.content as ContentBlock[]) ?? []) {
    if (block.type === "text") result.text += block.text ?? "";
    else if (block.type === "thinking") result.thinking += block.thinking ?? "";
    else if (block.type === "tool_use") {
      result.toolCalls.push({ name: block.name ?? "(unnamed)", input: block.input });
    }
  }
  return result;
}

function parseEventStream(raw: string, result: ParsedResponse): ParsedResponse {
  let open: ContentBlock | null = null;
  let partialJson = "";

  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let event: Record<string, any>;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }

    switch (event.type) {
      case "message_start":
        if (event.message?.usage) result.usage = { ...event.message.usage };
        break;

      case "content_block_start":
        open = event.content_block ?? null;
        partialJson = "";
        break;

      case "content_block_delta": {
        const delta = event.delta ?? {};
        if (delta.type === "text_delta") result.text += delta.text ?? "";
        else if (delta.type === "thinking_delta") result.thinking += delta.thinking ?? "";
        else if (delta.type === "input_json_delta") partialJson += delta.partial_json ?? "";
        break;
      }

      case "content_block_stop":
        if (open?.type === "tool_use") {
          result.toolCalls.push({
            name: open.name ?? "(unnamed)",
            // A tool's arguments arrive as a string built from many deltas.
            // Keeping the string when it will not parse is better than losing
            // the only record of what the model asked for.
            input: partialJson ? tryParse(partialJson) : open.input,
          });
        }
        open = null;
        partialJson = "";
        break;

      case "message_delta":
        if (event.usage) result.usage = { ...(result.usage ?? {}), ...event.usage };
        if (event.delta?.stop_reason) result.stopReason = event.delta.stop_reason;
        break;

      case "error":
        result.error = JSON.stringify(event.error ?? event);
        break;
    }
  }
  return result;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
