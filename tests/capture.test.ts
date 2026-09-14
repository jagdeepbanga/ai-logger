import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  countCacheBreakpoints,
  decodeBody,
  extractSkills,
  measure,
  messagesText,
  parseResponse,
  summariseTools,
  systemText,
} from "../src/capture.js";

describe("decodeBody", () => {
  it("reads a plain body", () => {
    expect(decodeBody(Buffer.from("hello"))).toBe("hello");
  });

  it("reads a gzipped body", () => {
    const body = zlib.gzipSync(Buffer.from('{"a":1}'));
    expect(decodeBody(body, "gzip")).toBe('{"a":1}');
  });

  it("falls back to text when the declared encoding is wrong", () => {
    // An agent that mislabels its body must still produce a readable capture
    // rather than an exception that loses the call.
    expect(decodeBody(Buffer.from("not gzipped"), "gzip")).toBe("not gzipped");
  });

  it("treats an empty body as empty", () => {
    expect(decodeBody(Buffer.alloc(0), "gzip")).toBe("");
  });
});

describe("systemText", () => {
  it("accepts the string form", () => {
    expect(systemText("be brief")).toBe("be brief");
  });

  it("joins the block form", () => {
    expect(systemText([{ type: "text", text: "one" }, { type: "text", text: "two" }])).toBe(
      "one\n\ntwo"
    );
  });

  it("is empty when there is no system prompt", () => {
    expect(systemText(undefined)).toBe("");
  });
});

describe("messagesText", () => {
  it("reads strings, text blocks and nested tool results", () => {
    const text = messagesText([
      { role: "user", content: "plain" },
      { role: "assistant", content: [{ type: "text", text: "block" }] },
      {
        role: "user",
        content: [
          { type: "tool_result", content: [{ type: "text", text: "nested" }] },
        ],
      },
    ]);
    expect(text).toContain("plain");
    expect(text).toContain("block");
    expect(text).toContain("nested");
  });

  it("preserves real newlines", () => {
    // The skill listing is line-anchored, so escaping newlines here would
    // silently break extraction downstream.
    expect(messagesText([{ role: "user", content: "a\nb" }])).toBe("a\nb");
  });
});

describe("extractSkills", () => {
  it("finds skills whether or not a description follows", () => {
    const text = [
      "The following skills are available for use with the Skill tool:",
      "",
      "- code-review: Review the changes since a fixed point.",
      "- codebase-design",
      "- vercel:next-forge: next-forge expert guidance.",
      "- laravel-best-practices",
    ].join("\n");
    expect(extractSkills(text).sort()).toEqual([
      "code-review",
      "codebase-design",
      "laravel-best-practices",
      "vercel:next-forge",
    ]);
  });

  it("keeps reading past a multi-line description", () => {
    // The real listing has descriptions that wrap to column zero and start
    // with a capital. A boundary rule based on blank-line-then-capital stops
    // here and loses everything after it.
    const text = [
      "skills are available for use with the Skill tool:",
      "",
      "- claude-api: Reference for the Claude API.",
      "TRIGGER — read BEFORE opening the target file.",
      "SKIP only when another provider is being worked on.",
      "- run: Launch and drive this project's app.",
    ].join("\n");
    expect(extractSkills(text)).toContain("run");
  });

  it("ignores prose bullets, which start with a capital", () => {
    const text = [
      "skills are available for use with the Skill tool:",
      "",
      "- tdd: Test-driven development.",
      "",
      "- Hard-to-reverse operations: force-pushing, and the like.",
      "- Uploading content to third-party web tools.",
    ].join("\n");
    expect(extractSkills(text)).toEqual(["tdd"]);
  });

  it("ignores bullets before the marker", () => {
    const text = ["- not-a-skill: from earlier in the chat", "skills are available:", "- real: yes"].join(
      "\n"
    );
    expect(extractSkills(text)).toEqual(["real"]);
  });

  it("finds an explicit skill tag anywhere", () => {
    expect(extractSkills('<skill name="laravel-ddd">')).toEqual(["laravel-ddd"]);
  });

  it("returns nothing when no listing is present", () => {
    expect(extractSkills("an ordinary prompt")).toEqual([]);
  });
});

describe("countCacheBreakpoints", () => {
  it("counts markers at any depth", () => {
    const request = {
      system: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "Bash", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    expect(countCacheBreakpoints(request)).toBe(2);
  });

  it("is zero when nothing is cached", () => {
    expect(countCacheBreakpoints({ messages: [] })).toBe(0);
  });
});

describe("summariseTools", () => {
  it("sorts largest first and flags MCP tools", () => {
    const tools = summariseTools({
      tools: [
        { name: "Small", description: "x" },
        { name: "mcp__server__big", description: "y".repeat(500) },
      ],
    });
    expect(tools[0]!.name).toBe("mcp__server__big");
    expect(tools[0]!.mcp).toBe(true);
    expect(tools[1]!.mcp).toBe(false);
  });

  it("is empty when a request carries no tools", () => {
    expect(summariseTools({})).toEqual([]);
  });
});

describe("parseResponse", () => {
  it("rebuilds a streamed reply", () => {
    const raw = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
      'data: {"type":"content_block_start","content_block":{"type":"text"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}',
      'data: {"type":"content_block_stop"}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}',
    ].join("\n");

    const result = parseResponse(raw);
    expect(result.text).toBe("Hello world");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 4 });
  });

  it("reassembles a tool call from its argument deltas", () => {
    const raw = [
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"Bash"}}',
      'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"command\\":"}}',
      'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"\\"ls\\"}"}}',
      'data: {"type":"content_block_stop"}',
    ].join("\n");

    const result = parseResponse(raw);
    expect(result.toolCalls).toEqual([{ name: "Bash", input: { command: "ls" } }]);
  });

  it("keeps a tool call whose arguments never completed", () => {
    // A truncated stream is exactly when the record matters most, so the
    // partial string is kept rather than discarded.
    const raw = [
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"Edit"}}',
      'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"broken"}}',
      'data: {"type":"content_block_stop"}',
    ].join("\n");
    expect(parseResponse(raw).toolCalls[0]!.input).toBe('{"broken');
  });

  it("collects thinking separately from text", () => {
    const raw = [
      'data: {"type":"content_block_start","content_block":{"type":"thinking"}}',
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}',
      'data: {"type":"content_block_stop"}',
      'data: {"type":"content_block_start","content_block":{"type":"text"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}',
      'data: {"type":"content_block_stop"}',
    ].join("\n");
    const result = parseResponse(raw);
    expect(result.thinking).toBe("hmm");
    expect(result.text).toBe("answer");
  });

  it("reads a non-streamed body", () => {
    const raw = JSON.stringify({
      content: [
        { type: "text", text: "hi" },
        { type: "tool_use", name: "Read", input: { file_path: "/a" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 3, output_tokens: 7 },
    });
    const result = parseResponse(raw);
    expect(result.text).toBe("hi");
    expect(result.toolCalls[0]!.name).toBe("Read");
    expect(result.stopReason).toBe("tool_use");
  });

  it("reports an error body", () => {
    const result = parseResponse('{"type":"error","error":{"message":"overloaded"}}');
    expect(result.error).toContain("overloaded");
  });

  it("reports an error event mid-stream", () => {
    const raw = 'data: {"type":"error","error":{"message":"cut off"}}';
    expect(parseResponse(raw).error).toContain("cut off");
  });

  it("survives junk", () => {
    const result = parseResponse("data: not json\n\nrandom text\n");
    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([]);
  });
});

describe("measure", () => {
  const base = {
    n: 1,
    time: "2026-09-14T12:00:00.000Z",
    durationMs: 1200,
    status: 200,
  };

  it("separates the three request sections", () => {
    const request = {
      model: "claude-opus-5",
      max_tokens: 4096,
      stream: true,
      system: [{ type: "text", text: "x".repeat(100) }],
      tools: [{ name: "Bash", description: "y".repeat(200) }],
      messages: [{ role: "user", content: "hello" }],
    };
    const requestRaw = JSON.stringify(request);

    const summary = measure({
      ...base,
      requestRaw,
      request,
      response: { text: "ok", thinking: "", toolCalls: [], usage: null, stopReason: "end_turn" },
    });

    expect(summary.model).toBe("claude-opus-5");
    expect(summary.systemChars).toBe(100);
    expect(summary.toolCount).toBe(1);
    expect(summary.messageCount).toBe(1);
    expect(summary.totalBytes).toBe(Buffer.byteLength(requestRaw, "utf8"));
    // Every section is a slice of the whole, so none may exceed it.
    expect(summary.systemBytes + summary.toolBytes + summary.messageBytes).toBeLessThanOrEqual(
      summary.totalBytes
    );
  });

  it("survives a request body that was not JSON", () => {
    const summary = measure({
      ...base,
      requestRaw: "<html>gateway error</html>",
      request: null,
      response: { text: "", thinking: "", toolCalls: [], usage: null, stopReason: null },
    });
    expect(summary.model).toBe("unknown");
    expect(summary.toolCount).toBe(0);
    expect(summary.totalBytes).toBeGreaterThan(0);
  });

  it("carries usage and called tools through from the response", () => {
    const summary = measure({
      ...base,
      requestRaw: "{}",
      request: {},
      response: {
        text: "abc",
        thinking: "xy",
        toolCalls: [{ name: "Bash", input: {} }],
        usage: { input_tokens: 5, cache_read_input_tokens: 900, output_tokens: 2 },
        stopReason: "tool_use",
      },
    });
    expect(summary.toolsCalled).toEqual(["Bash"]);
    expect(summary.usage.cache_read_input_tokens).toBe(900);
    expect(summary.responseChars).toBe(3);
    expect(summary.thinkingChars).toBe(2);
  });
});
