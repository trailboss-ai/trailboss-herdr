// The Live tab's tree: agents grouped by the folder they work in, each agent's children
// (from `live`'s `parent`) indented under it. Pure, so tree.test.mjs runs it under node.

const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop() || p;

/** `rows` from `trailboss live` as display lines, in order:
 *  { group: { folder, name, count, working } } heads each folder;
 *  { row, depth } is an agent, depth 0 at the top of its folder. Rows with no folder (a
 *  terminal that lost its agent) come last, under no heading.
 *  A child sits under its parent even when it works in another folder. */
export function liveTree(rows) {
  const byWhere = new Map(rows.map((r) => [r.where, r]));
  const kids = new Map();
  const roots = [];
  for (const r of rows) {
    const p = r.parent && r.parent !== r.where && byWhere.has(r.parent) ? r.parent : null;
    if (p) kids.set(p, [...(kids.get(p) ?? []), r]);
    else roots.push(r);
  }
  // Every agent under a root, depth first; a cycle (shouldn't happen) is cut.
  const seen = new Set();
  const walk = (r, depth, out) => {
    if (seen.has(r.where)) return out;
    seen.add(r.where);
    out.push({ row: r, depth });
    for (const k of kids.get(r.where) ?? []) walk(k, depth + 1, out);
    return out;
  };

  const groups = new Map();
  for (const r of roots) {
    const folder = r.workspace ?? r.cwd ?? "";
    groups.set(folder, [...(groups.get(folder) ?? []), r]);
  }
  const shared = [];
  const alone = [];
  for (const [folder, rs] of groups) {
    const lines = rs.flatMap((r) => walk(r, 0, []));
    if (folder) {
      const working = lines.filter((l) => l.row.status === "working").length;
      shared.push({ group: { folder, name: base(folder), count: lines.length, working } }, ...lines);
    } else alone.push(...lines);
  }
  // Anything only reachable through a cycle still shows, at the top level.
  const rest = rows.filter((r) => !seen.has(r.where)).map((row) => ({ row, depth: 0 }));
  return [...shared, ...alone, ...rest];
}
