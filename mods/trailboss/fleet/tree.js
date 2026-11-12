// The Live tab's tree: agents grouped by the folder they work in, each agent's children
// (from `live`'s `parent`) indented under it, the ones that need you first. Pure, so
// tree.test.mjs runs it under node.

import { rank } from "./live.js";

const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop() || p;

// Pinned agents first, then the most urgent (rank()); otherwise as `live` lists them.
const byUrgency = (key) => (a, b) => (b.pinned === true) - (a.pinned === true) || key(a) - key(b);

/** The List view: one line per agent, pinned and most urgent first. */
export const liveList = (rows) => [...rows].sort(byUrgency(rank)).map((row) => ({ row, depth: 0 }));

/** `rows` from `trailboss live` as display lines, in order:
 *  { group: { folder, name, count, working, needs } } heads each folder;
 *  { row, depth } is an agent, depth 0 at the top of its folder. Rows with no folder (a
 *  terminal that lost its agent) come last, under no heading.
 *  A child sits under its parent even when it works in another folder.
 *  In a folder, pinned agents come first, then those that need you, finished, working and
 *  at rest; an agent counts as urgent as its most urgent child, so a blocked sub-agent
 *  brings its parent up. Folders go by their most urgent agent. */
export function liveTree(rows) {
  const byWhere = new Map(rows.map((r) => [r.where, r]));
  const kids = new Map();
  const roots = [];
  for (const r of rows) {
    const p = r.parent && r.parent !== r.where && byWhere.has(r.parent) ? r.parent : null;
    if (p) kids.set(p, [...(kids.get(p) ?? []), r]);
    else roots.push(r);
  }
  // An agent and everything under it: its most urgent rank. A cycle is cut.
  const urgent = new Map();
  const urgency = (r, path = new Set()) => {
    if (urgent.has(r.where)) return urgent.get(r.where);
    if (path.has(r.where)) return rank(r);
    path.add(r.where);
    const u = Math.min(rank(r), ...(kids.get(r.where) ?? []).map((k) => urgency(k, path)));
    urgent.set(r.where, u);
    return u;
  };
  const order = (rs) => [...rs].sort(byUrgency((r) => urgency(r)));

  // Every agent under a root, depth first; a cycle (shouldn't happen) is cut.
  const seen = new Set();
  const walk = (r, depth, out) => {
    if (seen.has(r.where)) return out;
    seen.add(r.where);
    out.push({ row: r, depth });
    for (const k of order(kids.get(r.where) ?? [])) walk(k, depth + 1, out);
    return out;
  };

  const groups = new Map();
  for (const r of order(roots)) {
    const folder = r.workspace ?? r.cwd ?? "";
    groups.set(folder, [...(groups.get(folder) ?? []), r]);
  }
  const shared = [];
  const alone = [];
  for (const [folder, rs] of groups) {
    const lines = rs.flatMap((r) => walk(r, 0, []));
    if (folder) {
      const working = lines.filter((l) => l.row.status === "working").length;
      const needs = lines.filter((l) => rank(l.row) === 0).length;
      const most = Math.min(...lines.map((l) => rank(l.row)));
      shared.push({ most, lines: [{ group: { folder, name: base(folder), count: lines.length, working, needs } }, ...lines] });
    } else alone.push(...lines);
  }
  shared.sort((a, b) => a.most - b.most);
  // Anything only reachable through a cycle still shows, at the top level.
  const rest = rows.filter((r) => !seen.has(r.where)).map((row) => ({ row, depth: 0 }));
  return [...shared.flatMap((g) => g.lines), ...alone, ...rest];
}
