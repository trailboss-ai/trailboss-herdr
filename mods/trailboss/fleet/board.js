// Live's Board view, from `trailboss live --board`: its groups in order (needs you, working,
// done, idle, failed, stopped), sub-agents at work under the row that started them, then
// "+N at rest" and the settled count, each opening its rows. Pure, so board.test.mjs runs it
// under node.

// Each group's heading; one the CLI adds later shows by its own name.
const NAMES = { needs_you: "Needs you", working: "Working", done: "Done", idle: "Idle", failed: "Failed", stopped: "Stopped" };
export const stateName = (s) => NAMES[s] ?? (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : "");

// The theme color a group's heading takes.
const TONES = { needs_you: "blocked", failed: "blocked", working: "working", done: "done" };
export const groupTone = (s) => TONES[s] ?? "dim";

// Whether `live --board` gave a board this view can draw.
export const isBoard = (b) => Boolean(b && Array.isArray(b.groups));

const rowsOf = (part) => (Array.isArray(part?.rows) ? part.rows : []);
const countOf = (part) => (Number.isInteger(part?.count) ? part.count : rowsOf(part).length);

// Every row on the board, sub-agents, folded and settled ones included, each once: what the
// rest of Live (send, sweep, until loops, recaps) works on, as it does `live`'s rows.
export function boardRows(b) {
  if (!isBoard(b)) return [];
  const out = [];
  const seen = new Set();
  const add = (r) => {
    if (!r || typeof r !== "object" || seen.has(r)) return;
    seen.add(r);
    out.push(r);
    for (const k of Array.isArray(r.subagents) ? r.subagents : []) add(k);
  };
  for (const g of b.groups) for (const r of rowsOf(g)) add(r);
  for (const r of [...rowsOf(b.folded), ...rowsOf(b.settled)]) add(r);
  return out;
}

/** The board as display lines, in order:
 *  { group: { state, name, count } } heads each group that has rows (count: its rows and
 *  their sub-agents);
 *  { row, depth } is an agent, its sub-agents at work under it at depth + 1;
 *  { more: "folded" | "settled", count, open } is "+N at rest" or "N settled", with its rows
 *  after it when `open` has it. */
export function boardLines(b, open = new Set()) {
  if (!isBoard(b)) return [];
  const out = [];
  const seen = new Set();
  const walk = (r, depth, lines) => {
    if (!r || typeof r !== "object" || seen.has(r)) return lines;
    seen.add(r);
    lines.push({ row: r, depth });
    for (const k of Array.isArray(r.subagents) ? r.subagents : []) walk(k, depth + 1, lines);
    return lines;
  };
  for (const g of b.groups) {
    const lines = rowsOf(g).flatMap((r) => walk(r, 0, []));
    if (lines.length) out.push({ group: { state: g.state, name: stateName(g.state), count: lines.length } }, ...lines);
  }
  for (const more of ["folded", "settled"]) {
    const count = countOf(b[more]);
    if (!count) continue;
    const shown = open.has(more);
    out.push({ more, count, open: shown });
    if (shown) for (const r of rowsOf(b[more])) out.push(...walk(r, 0, []));
  }
  return out;
}

// "+3 at rest", "2 settled": what a `more` line says.
export const moreText = (more, count) => (more === "folded" ? `+${count} at rest` : `${count} settled`);
export const moreTip = (more) =>
  more === "folded"
    ? "At rest for over an hour, not pinned or settled"
    : "Settled with Settle (trailboss live --settle): back on their own when they need you, finish or start a turn";
