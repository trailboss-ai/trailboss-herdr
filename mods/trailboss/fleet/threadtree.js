// The thread pane's Tree view, from `trailboss thread <AGENT:ID> --tree`: the turns of a
// session and of the sessions branched from it (forks, subagents, sessions it started), as an
// indented list. Pure, so threadtree.test.mjs runs it under node.

// The small marker on a branch's first turn, by its edge; an edge this mod doesn't know shows
// its own name.
const EDGES = { forked: "⑂ forked", subagent: "↳ subagent", started: "↗ started" };
export const edgeMarker = (edge) => (!edge || edge === "continues" ? "" : (EDGES[edge] ?? edge));

// The first non-empty line of a prompt, cut short; a placeholder when there's none.
export function promptLine(prompt, width = 120) {
  const l = (prompt ?? "").split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  if (!l) return "(empty prompt)";
  return l.length > width ? `${l.slice(0, width - 1)}…` : l;
}

// The Herdr terminal a node's session runs in, when Herdr runs it; else null.
export const nodeTerminal = (node) => (node?.terminal && (node.host ?? "herdr") === "herdr" ? node.terminal : null);

/** What a click on a node does: { turn } for a turn of the pane's own session (`mine`, its
 *  AGENT:ID; the tree's `focus` when not given), { terminal } for another session running in a
 *  Herdr terminal, else null (not clickable). */
export function nodeAction(node, data, mine) {
  const own = mine ?? data?.focus ?? null;
  if (!node) return null;
  if (own && node.session === own) return node.turn != null ? { turn: node.turn } : null;
  const terminal = nodeTerminal(node);
  return terminal ? { terminal } : null;
}

/** The tree's nodes as display lines, in the CLI's order: { node, depth, marker, label, state,
 *  last, mine }. `marker` is set on a branch's first turn; `state` (the badge) only on a
 *  session's last turn; `mine` on the turns of the pane's own session. */
export function treeLines(data, mine) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const own = mine ?? data?.focus ?? null;
  const lastOf = new Map();
  for (const n of nodes) lastOf.set(n.session, n.id);
  return nodes.map((node) => {
    const last = lastOf.get(node.session) === node.id;
    return {
      node,
      depth: Math.max(0, Number(node.depth) || 0),
      marker: edgeMarker(node.edge),
      label: `#${node.turn ?? "?"}  ${promptLine(node.prompt)}`,
      state: last ? (node.state ?? null) : null,
      last,
      mine: Boolean(own) && node.session === own,
    };
  });
}

// "3 sessions · 12 turns": what the tree holds.
export function treeCounts(data) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const s = new Set(nodes.map((n) => n.session)).size;
  return `${s} ${s === 1 ? "session" : "sessions"} · ${nodes.length} ${nodes.length === 1 ? "turn" : "turns"}`;
}
