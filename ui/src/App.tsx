/**
 * The viewer.
 *
 * State is kept in the URL hash — `#/project/session/call` — so a specific
 * call can be linked to, the back button works, and a reload lands where it
 * left off. That is worth more here than a router dependency would be.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CallDetail as Detail, CallSummary, SessionListItem, SessionMeta } from "../../src/types";
import * as api from "./api";
import { CallDetail } from "./components/CallDetail";
import { Sidebar } from "./components/Sidebar";
import { SessionView } from "./components/SessionView";
import { Button, Empty, Panel, Spinner } from "./components/primitives";

interface Route {
  project?: string;
  session?: string;
  call?: number;
}

function readRoute(): Route {
  const [project, session, call] = window.location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .map((part) => (part ? decodeURIComponent(part) : ""));
  return {
    project: project || undefined,
    session: session || undefined,
    call: call ? Number(call) : undefined,
  };
}

function writeRoute(route: Route): void {
  const parts = [route.project, route.session, route.call?.toString()].filter(Boolean);
  const hash = parts.length ? `#/${parts.map((p) => encodeURIComponent(p!)).join("/")}` : "#/";
  if (window.location.hash !== hash) window.location.hash = hash;
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [session, setSession] = useState<{ meta: SessionMeta; calls: CallSummary[] } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const onHashChange = (): void => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const result = await api.fetchSessions();
      setSessions(result.sessions);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // The server pushes a message whenever a recording changes on disk. The
  // open session is refetched too, so a running agent's calls stream in.
  useEffect(() => {
    return api.subscribe(() => {
      void loadSessions();
      const { project, session: id } = readRoute();
      if (project && id) {
        void api
          .fetchSession(project, id)
          .then(setSession)
          .catch(() => {});
      }
    });
  }, [loadSessions]);

  useEffect(() => {
    if (!route.project || !route.session) {
      setSession(null);
      return;
    }
    let cancelled = false;
    void api
      .fetchSession(route.project, route.session)
      .then((result) => {
        if (!cancelled) {
          setSession(result);
          setError(null);
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [route.project, route.session]);

  useEffect(() => {
    if (!route.project || !route.session || route.call === undefined) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void api
      .fetchCall(route.project, route.session, route.call)
      .then((result) => !cancelled && setDetail(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [route.project, route.session, route.call]);

  const selected = useMemo(
    () => (route.project && route.session ? { project: route.project, id: route.session } : null),
    [route.project, route.session]
  );

  const live = useMemo(
    () =>
      Boolean(
        sessions?.some(
          (item) => item.live && item.project === route.project && item.id === route.session
        )
      ),
    [sessions, route.project, route.session]
  );

  const go = useCallback((next: Route) => {
    writeRoute(next);
    setRoute(next);
  }, []);

  const stepCall = useCallback(
    (delta: number) => {
      if (!session || route.call === undefined) return;
      const numbers = session.calls.map((call) => call.n);
      const index = numbers.indexOf(route.call);
      const target = numbers[Math.min(Math.max(index + delta, 0), numbers.length - 1)];
      if (target !== undefined && target !== route.call) {
        go({ project: route.project, session: route.session, call: target });
      }
    },
    [session, route, go]
  );

  const toggleTheme = (): void => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("llmlogger:theme", next ? "dark" : "light");
  };

  const removeSession = async (project: string, id: string): Promise<void> => {
    if (!window.confirm(`Delete the recording ${project}/${id}?`)) return;
    await api.deleteSession(project, id);
    if (route.project === project && route.session === id) go({});
    void loadSessions();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <button type="button" onClick={() => go({})} className="flex items-center gap-2">
          <span className="text-base">🔍</span>
          <span className="text-sm font-semibold tracking-tight">llmlogger</span>
        </button>
        <span className="hidden text-xs text-zinc-500 sm:block">
          every request Claude Code sends to the model
        </span>
        <div className="ml-auto flex items-center gap-2">
          {sessions && (
            <span className="hidden font-mono text-[11px] text-zinc-500 sm:block">
              {sessions.length} recording{sessions.length === 1 ? "" : "s"}
            </span>
          )}
          <Button onClick={toggleTheme} title="Toggle light and dark">
            {dark ? "☀" : "☾"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessions={sessions ?? []}
          selected={selected}
          onSelect={(project, id) => go({ project, session: id })}
          onDelete={(project, id) => void removeSession(project, id)}
        />

        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {sessions === null && <Spinner label="Reading recordings" />}

          {sessions !== null && !selected && (
            <div className="p-6">
              <Panel>
                <Empty
                  title={
                    sessions.length === 0
                      ? "No recordings yet"
                      : "Pick a session on the left"
                  }
                  hint={
                    sessions.length === 0 ? (
                      <>
                        Run <code className="font-mono">llmlogger</code> in a project instead of{" "}
                        <code className="font-mono">claude</code>. Every request that session
                        makes appears here, live.
                      </>
                    ) : (
                      "Each session is one run of the agent in one directory."
                    )
                  }
                />
              </Panel>
            </div>
          )}

          {selected && session && route.call === undefined && (
            <SessionView
              meta={session.meta}
              calls={session.calls}
              live={live}
              onOpenCall={(n) => go({ ...route, call: n })}
            />
          )}

          {selected && route.call !== undefined && detail && (
            <CallDetail
              detail={detail}
              project={selected.project}
              sessionId={selected.id}
              onBack={() => go({ project: selected.project, session: selected.id })}
              onStep={stepCall}
            />
          )}

          {selected && route.call !== undefined && !detail && <Spinner label="Reading call" />}
        </main>
      </div>
    </div>
  );
}
