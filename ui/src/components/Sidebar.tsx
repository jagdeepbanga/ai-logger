/**
 * The session list, grouped by project.
 *
 * Grouping is by project because that is how the question arrives: "what did
 * Claude send in the Laravel app yesterday". A live session sorts to the top
 * of its project and shows a pulse, so the viewer is useful while an agent is
 * still running.
 */

import { useMemo, useState } from "react";
import type { SessionListItem } from "../../../src/types";
import { bytes, num, relative, sessionLabel } from "../format";

export function Sidebar({
  sessions,
  selected,
  onSelect,
  onDelete,
}: {
  sessions: SessionListItem[];
  selected: { project: string; id: string } | null;
  onSelect: (project: string, id: string) => void;
  onDelete: (project: string, id: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? sessions.filter(
          (session) =>
            session.project.toLowerCase().includes(needle) ||
            session.id.toLowerCase().includes(needle)
        )
      : sessions;

    const byProject = new Map<string, SessionListItem[]>();
    for (const session of matching) {
      const list = byProject.get(session.project) ?? [];
      list.push(session);
      byProject.set(session.project, list);
    }
    // A project with something running belongs at the top of the list.
    return [...byProject.entries()].sort(([, a], [, b]) => {
      const liveA = a.some((s) => s.live) ? 1 : 0;
      const liveB = b.some((s) => s.live) ? 1 : 0;
      if (liveA !== liveB) return liveB - liveA;
      // Matches the server's ordering, which sorts on the id for the reason
      // given in store.ts.
      return (b[0]?.id ?? "").localeCompare(a[0]?.id ?? "");
    });
  }, [sessions, filter]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="p-3">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter projects…"
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-zinc-500">
            {sessions.length === 0 ? "No recordings yet." : "Nothing matches that filter."}
          </p>
        )}

        {groups.map(([project, list]) => (
          <div key={project} className="mb-3">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <h3 className="truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {project}
              </h3>
              {list.some((session) => session.live) && (
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              )}
              <span className="ml-auto text-[11px] text-zinc-400">{list.length}</span>
            </div>

            <ul className="space-y-0.5">
              {list.map((session) => {
                const isSelected =
                  selected?.project === session.project && selected?.id === session.id;
                return (
                  <li key={session.id}>
                    <div
                      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${
                        isSelected
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(session.project, session.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          {session.live && (
                            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                          )}
                          <span className="truncate font-mono text-xs">
                            {sessionLabel(session.id)}
                          </span>
                        </div>
                        <div
                          className={`mt-0.5 truncate text-[11px] ${
                            isSelected ? "opacity-70" : "text-zinc-500"
                          }`}
                        >
                          {session.calls} calls · {bytes(session.totalBytes)} ·{" "}
                          {num(session.outputTokens)} out · {relative(session.lastActivity)}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Delete this recording"
                        onClick={() => onDelete(session.project, session.id)}
                        className={`shrink-0 rounded px-1 text-xs opacity-0 transition group-hover:opacity-60 hover:!opacity-100 ${
                          isSelected ? "" : "text-zinc-500"
                        }`}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
