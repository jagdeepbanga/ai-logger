/**
 * Small derivations the viewer needs.
 *
 * `systemTextOf` mirrors the recorder's `systemText`, because the viewer reads
 * the stored request body rather than a pre-flattened string: keeping the raw
 * body means a future field is still there to look at, at the cost of this one
 * function being needed in both places.
 */

import type { AnthropicRequest } from "../../src/types";

export function systemTextOf(system: AnthropicRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) return system.map((block) => block?.text ?? "").join("\n\n");
  return "";
}
