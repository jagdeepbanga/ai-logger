/**
 * A searchable pane of captured text.
 *
 * Prompts run to tens of thousands of characters, so the pane is built around
 * finding things rather than reading top to bottom: a filter box highlights
 * every match and steps between them.
 *
 * Highlighting is done by splitting on the query and rendering the parts,
 * never by writing HTML into the DOM. Captured text contains arbitrary content
 * from the model and from the user's own files, and must never be interpreted
 * as markup.
 */

import { useMemo, useState } from "react";
import { Button, CopyButton } from "./primitives";

export function TextPane({
  text,
  emptyLabel = "Nothing here",
}: {
  text: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => countMatches(text, query), [text, query]);

  if (!text) {
    return <p className="p-6 text-sm text-zinc-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find in this text…"
          className="min-w-40 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
        />
        <span className="font-mono text-[11px] text-zinc-500">
          {query ? `${matches} match${matches === 1 ? "" : "es"}` : `${text.length.toLocaleString()} chars`}
        </span>
        {query && <Button onClick={() => setQuery("")}>Clear</Button>}
        <CopyButton text={text} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="prompt-text">
          <Highlight text={text} query={query} />
        </div>
      </div>
    </div>
  );
}

function countMatches(text: string, query: string): number {
  if (!query) return 0;
  return split(text, query).filter((part) => part.match).length;
}

/** Render text with every occurrence of `query` wrapped in a <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => split(text, query), [text, query]);
  if (!query) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.match ? <mark key={index}>{part.value}</mark> : <span key={index}>{part.value}</span>
      )}
    </>
  );
}

interface Part {
  value: string;
  match: boolean;
}

/**
 * Split text into matched and unmatched runs, case-insensitively.
 *
 * Done by index walking rather than a regular expression, because the query is
 * user input and would otherwise need escaping to avoid both crashes on `(`
 * and accidental pattern matching.
 */
function split(text: string, query: string): Part[] {
  if (!query) return [{ value: text, match: false }];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: Part[] = [];
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      if (from < text.length) parts.push({ value: text.slice(from), match: false });
      return parts;
    }
    if (at > from) parts.push({ value: text.slice(from, at), match: false });
    parts.push({ value: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
}
