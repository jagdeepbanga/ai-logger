/**
 * The shapes shared by the recorder, the HTTP API and the UI.
 *
 * The UI imports this file directly rather than keeping its own copy, so a
 * change to a captured field is a type error in the viewer instead of an
 * empty column.
 */

/** Token accounting as the Anthropic API reports it. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
}

/** One tool definition, reduced to what is worth charting. */
export interface ToolSummary {
  name: string;
  bytes: number;
  /** True for tools supplied by an MCP server rather than built in. */
  mcp: boolean;
  description?: string;
}

/** A tool the model asked to run, taken from the response. */
export interface ToolCall {
  name: string;
  input: unknown;
}

/**
 * The summary of one generation call.
 *
 * This is the whole of `index.jsonl`, one object per line, and the only thing
 * the session list and the charts read. It is deliberately small: the full
 * request and response live in separate files so that listing a session with
 * hundreds of calls never loads megabytes of prompt text.
 */
export interface CallSummary {
  n: number;
  time: string;
  durationMs: number;
  status: number;
  model: string;
  stream: boolean;
  maxTokens?: number;
  /** Byte sizes of the request as it went over the wire. */
  totalBytes: number;
  systemBytes: number;
  toolBytes: number;
  messageBytes: number;
  systemChars: number;
  toolCount: number;
  mcpToolCount: number;
  messageCount: number;
  cacheBreakpoints: number;
  skills: string[];
  tools: ToolSummary[];
  toolsCalled: string[];
  stopReason: string | null;
  usage: Usage;
  responseChars: number;
  thinkingChars: number;
  error?: string;
}

/** A recorded session: one `ai-logger run` in one project directory. */
export interface SessionMeta {
  id: string;
  project: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  args: string[];
  claudeVersion?: string;
}

/** A session plus the totals the list view shows without opening it. */
export interface SessionListItem extends SessionMeta {
  calls: number;
  totalBytes: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  /** True while a recorder is still writing to this session. */
  live: boolean;
  lastActivity: string;
}

/** Everything one call detail view needs, assembled on request. */
export interface CallDetail {
  summary: CallSummary;
  /** The request body, parsed. Null when it was not valid JSON. */
  request: AnthropicRequest | null;
  /** The raw request text, for the raw view and for copying. */
  requestRaw: string;
  response: ParsedResponse;
  headers: Record<string, string>;
}

export interface AnthropicRequest {
  model?: string;
  max_tokens?: number;
  stream?: boolean;
  system?: string | ContentBlock[];
  tools?: ToolDefinition[];
  messages?: Message[];
  [key: string]: unknown;
}

export interface ToolDefinition {
  name?: string;
  description?: string;
  input_schema?: unknown;
  [key: string]: unknown;
}

export interface Message {
  role: "user" | "assistant" | string;
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: string | ContentBlock[];
  tool_use_id?: string;
  is_error?: boolean;
  cache_control?: unknown;
  [key: string]: unknown;
}

/** A streamed or non-streamed response, rebuilt into readable pieces. */
export interface ParsedResponse {
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  stopReason: string | null;
  /** Present when the upstream returned an error body rather than content. */
  error?: string;
}
