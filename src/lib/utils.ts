import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Next focus index for ↑/↓ list navigation. `current` is the focused item's
 *  index, or -1 when focus is outside the list (e.g. a search box). Down from
 *  outside lands on the first item; up from outside stays out (-1). Movement
 *  clamps at both ends. */
export function nextNavIndex(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : -1;
  return Math.max(0, Math.min(count - 1, current + dir));
}

/** Heuristic: does this text look like a unified / edit-style diff? True when
 *  it has a `@@ … @@` hunk header or `diff --git` line, or when added (`+`) and
 *  removed (`-`) lines together make up a meaningful share of the content. Plain
 *  markdown lists (only `-`/`*`) won't match because both signs are required. */
export function isDiffText(text: string): boolean {
  const lines = text.split("\n");
  if (lines[0]?.startsWith("diff --git")) return true;
  if (lines.some((l) => /^@@ .* @@/.test(l))) return true;
  let plus = 0;
  let minus = 0;
  let total = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    total++;
    if (/^\+(?!\+\+)/.test(l)) plus++;
    else if (/^-(?!--)/.test(l)) minus++;
  }
  return plus > 0 && minus > 0 && (plus + minus) / Math.max(total, 1) >= 0.3;
}

/** Classify a single diff line for coloring. */
export function diffLineKind(line: string): "hunk" | "add" | "del" | "ctx" {
  if (line.startsWith("@@") || line.startsWith("diff --git")) return "hunk";
  if (/^\+(?!\+\+)/.test(line)) return "add";
  if (/^-(?!--)/.test(line)) return "del";
  return "ctx";
}

/** Case-insensitive match of a conversation against a search query, testing
 *  its title, project name, and provider tool. Empty query matches everything. */
export function conversationMatches(
  c: { title: string | null; projectName: string; tool: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (c.title ?? "").toLowerCase().includes(q) ||
    c.projectName.toLowerCase().includes(q) ||
    c.tool.toLowerCase().includes(q)
  );
}

/** Compact relative time ("now", "5m", "3h", "2d", "4w", "6mo") from an ISO
 *  timestamp. Empty string for null/unparseable input. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}
