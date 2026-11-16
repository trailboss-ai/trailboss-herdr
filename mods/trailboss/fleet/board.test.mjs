// node mods/trailboss/fleet/board.test.mjs
import assert from "node:assert/strict";
import { stateName, groupTone, isBoard, boardRows, boardLines, moreText, moreTip } from "./board.js";

// A board shaped as `live --board` gives it (synthetic rows, only the fields read here).
const sub = { where: "t6 api", agent: "copilot", status: "working", parent: "t3 api", subagents: [] };
const parent = { where: "t3 api", agent: "claude", status: "working", subagents: [sub] };
const board = {
  groups: [
    { state: "needs_you", rows: [{ where: "t5 api", agent: "codex", status: "blocked", subagents: [] }] },
    { state: "working", rows: [parent, { where: "pid 52311", agent: "copilot", status: "working", quiet: true, subagents: [] }] },
    { state: "done", rows: [] },
    { state: "idle", rows: [] },
    { state: "failed", rows: [{ where: "pid 52140", agent: "codex", status: "idle", subagents: [] }] },
    { state: "stopped", rows: [{ where: "t8 web", status: "lost (trailboss resume)", subagents: [] }] },
    { state: "new_state", rows: [{ where: "t9 web", agent: "pi", status: "idle", subagents: [] }] },
  ],
  folded: { count: 1, rows: [{ where: "t4 notes", agent: "pi", status: "idle" }] },
  settled: { count: 1, rows: [{ where: "t7 web", agent: "pi", status: "idle", settled: true }] },
};

assert.equal(isBoard(board), true);
assert.equal(isBoard([]), false); // `live`'s rows, not a board
assert.equal(isBoard(null), false);

assert.equal(stateName("needs_you"), "Needs you");
assert.equal(stateName("new_state"), "New state");
assert.equal(groupTone("needs_you"), "blocked");
assert.equal(groupTone("idle"), "dim");

// Every row once, sub-agents, folded and settled ones included.
assert.deepEqual(
  boardRows(board).map((r) => r.where),
  ["t5 api", "t3 api", "t6 api", "pid 52311", "pid 52140", "t8 web", "t9 web", "t4 notes", "t7 web"],
);
assert.equal(boardRows(board)[2], sub); // the same objects, so Live's per-row state finds them
assert.deepEqual(boardRows({ groups: "x" }), []);
{
  const c = { where: "c", subagents: [] };
  c.subagents.push(c);
  assert.deepEqual(boardRows({ groups: [{ state: "working", rows: [c] }] }).length, 1);
}

const show = (lines) =>
  lines.map((l) => (l.group ? `# ${l.group.name} ${l.group.count}` : l.more ? `${l.open ? "-" : "+"} ${moreText(l.more, l.count)}` : `${"  ".repeat(l.depth)}${l.row.where}`));

// Groups in the CLI's order, empty ones left out; a sub-agent under its parent.
assert.deepEqual(show(boardLines(board)), [
  "# Needs you 1",
  "t5 api",
  "# Working 3",
  "t3 api",
  "  t6 api",
  "pid 52311",
  "# Failed 1",
  "pid 52140",
  "# Stopped 1",
  "t8 web",
  "# New state 1",
  "t9 web",
  "+ +1 at rest",
  "+ 1 settled",
]);
// Opened, their rows follow.
assert.deepEqual(show(boardLines(board, new Set(["folded", "settled"]))).slice(-4), ["- +1 at rest", "t4 notes", "- 1 settled", "t7 web"]);
// Nothing folded or settled (--all, or none): no such lines.
assert.deepEqual(show(boardLines({ groups: board.groups.slice(0, 1), folded: { count: 0, rows: [] }, settled: { count: 0, rows: [] } })), ["# Needs you 1", "t5 api"]);
// A count without rows (shouldn't happen) still says how many.
assert.deepEqual(show(boardLines({ groups: [], folded: { count: 3 }, settled: {} }, new Set(["folded"]))), ["- +3 at rest"]);
// A sub-agent cycle (shouldn't happen) is cut.
const a = { where: "a", subagents: [] };
a.subagents.push(a);
assert.deepEqual(show(boardLines({ groups: [{ state: "working", rows: [a] }] })), ["# Working 1", "a"]);
assert.deepEqual(boardLines(undefined), []);

assert.equal(moreText("folded", 3), "+3 at rest");
assert.equal(moreText("settled", 2), "2 settled");
assert.match(moreTip("settled"), /live --settle/);

console.log("board.test.mjs: ok");
