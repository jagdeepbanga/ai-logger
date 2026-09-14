import { describe, expect, it } from "vitest";
import { forwardHeaders, isGeneration, redactHeaders } from "../src/recorder.js";

describe("isGeneration", () => {
  it("records a messages POST", () => {
    expect(isGeneration("POST", "/v1/messages")).toBe(true);
    expect(isGeneration("post", "/v1/messages?beta=true")).toBe(true);
  });

  it("skips token counting", () => {
    // A turn fans out into these. Recording them would bury every real turn.
    expect(isGeneration("POST", "/v1/messages/count_tokens")).toBe(false);
  });

  it("skips anything that is not a messages POST", () => {
    expect(isGeneration("GET", "/v1/messages")).toBe(false);
    expect(isGeneration("POST", "/v1/models")).toBe(false);
    expect(isGeneration("POST", "/v1/organizations/usage")).toBe(false);
  });
});

describe("forwardHeaders", () => {
  const body = Buffer.from('{"a":1}');

  it("passes the credential through untouched", () => {
    // The proxy must not break authentication; it only keeps a copy of the
    // request, and the copy is what gets redacted.
    const out = forwardHeaders({ authorization: "Bearer real-token" }, body);
    expect(out.authorization).toBe("Bearer real-token");
  });

  it("drops hop-by-hop headers", () => {
    const out = forwardHeaders(
      { host: "127.0.0.1:1234", connection: "keep-alive", "transfer-encoding": "chunked" },
      body
    );
    expect(out.host).toBeUndefined();
    expect(out.connection).toBeUndefined();
    expect(out["transfer-encoding"]).toBeUndefined();
  });

  it("asks for an unencoded response so the capture is readable", () => {
    const out = forwardHeaders({ "accept-encoding": "gzip, br" }, body);
    expect(out["accept-encoding"]).toBeUndefined();
  });

  it("keeps the request's own encoding", () => {
    // Upstream must receive exactly the bytes the agent produced, so this one
    // stays even though it makes the body unreadable without decoding.
    const out = forwardHeaders({ "content-encoding": "gzip" }, body);
    expect(out["content-encoding"]).toBe("gzip");
  });

  it("recomputes the length against the buffered body", () => {
    const out = forwardHeaders({ "content-length": "99999" }, body);
    expect(out["content-length"]).toBe(String(body.length));
  });

  it("sets no length for an empty body", () => {
    const out = forwardHeaders({ "content-length": "10" }, Buffer.alloc(0));
    expect(out["content-length"]).toBeUndefined();
  });
});

describe("redactHeaders", () => {
  it("replaces every credential header", () => {
    const out = redactHeaders({
      authorization: "Bearer secret",
      "x-api-key": "sk-ant-secret",
      "api-key": "secret",
      cookie: "session=secret",
      "proxy-authorization": "Basic secret",
    });
    for (const value of Object.values(out)) expect(value).toBe("<redacted>");
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("is case insensitive, because header case is not guaranteed", () => {
    expect(redactHeaders({ Authorization: "Bearer secret" }).Authorization).toBe("<redacted>");
  });

  it("keeps the header name, so its presence is still visible", () => {
    expect(Object.keys(redactHeaders({ authorization: "x" }))).toEqual(["authorization"]);
  });

  it("leaves ordinary headers alone", () => {
    const out = redactHeaders({ "user-agent": "claude-cli/2.1", "anthropic-version": "2023-06-01" });
    expect(out["user-agent"]).toBe("claude-cli/2.1");
    expect(out["anthropic-version"]).toBe("2023-06-01");
  });

  it("joins a repeated header rather than losing it", () => {
    expect(redactHeaders({ "set-cookie": ["a=1", "b=2"] })["set-cookie"]).toBe("<redacted>");
    expect(redactHeaders({ accept: ["a", "b"] }).accept).toBe("a, b");
  });
});
