/**
 * The small shared pieces. Everything here is presentational: no fetching, no
 * routing, so the views below can be read as layout.
 */

import { useEffect, useState, type ReactNode } from "react";

/**
 * The three request sections have fixed colours everywhere they appear — in
 * the bars, the legend, the table and the tabs — so the reader learns them
 * once. They are defined here rather than inline so a change cannot leave one
 * chart disagreeing with another.
 */
export const SECTION = {
  system: {
    label: "System prompt",
    fill: "#3b82f6",
    text: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500",
  },
  tools: {
    label: "Tool schemas",
    fill: "#f59e0b",
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500",
  },
  messages: {
    label: "Messages",
    fill: "#10b981",
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500",
  },
} as const;

export type SectionKey = keyof typeof SECTION;

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/60 ${className}`}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/** One headline number, with an optional sublabel for context. */
export function Stat({
  label,
  value,
  sub,
  accent = "",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Panel className="px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </Panel>
  );
}

export function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "amber" | "emerald" | "violet" | "red";
  title?: string;
}) {
  const tones = {
    neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
    red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  } as const;
  return (
    <span
      title={title}
      className={`inline-block rounded-md px-1.5 py-0.5 font-mono text-[11px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  active = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

/** Copies text to the clipboard and says so for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <Button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setDone(true));
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-zinc-500">
      <span className="size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
      {label}…
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{title}</p>
      {hint && <p className="mx-auto mt-2 max-w-md text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** A horizontal proportion bar. Used for section sizes and cache share. */
export function ProportionBar({
  parts,
}: {
  parts: Array<{ value: number; className: string; label: string }>;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      {parts.map((part) => (
        <div
          key={part.label}
          title={`${part.label}: ${Math.round((part.value / total) * 100)}%`}
          className={part.className}
          style={{ width: `${(part.value / total) * 100}%` }}
        />
      ))}
    </div>
  );
}
