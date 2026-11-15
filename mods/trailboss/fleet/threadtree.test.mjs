// node mods/trailboss/fleet/threadtree.test.mjs
import assert from "node:assert/strict";
import { edgeMarker, promptLine, nodeTerminal, nodeAction, treeLines, treeCounts } from "./threadtree.js";

// Shaped like `trailboss --json thread claude:bbbb --tree` (made up): a root session of three
// turns, a fork from its first turn (the pane's session), a subagent from the fork, and a
// session the root started that runs outside Herdr.
const node = (session, turn, parent, edge, depth, prompt, extra = {}) => ({
  id: `${session}#${turn}`,
  session,
  agent: session.split(":")[0],
  turn,
  parent,
  edge,
  depth,
  prompt,
  at_ms: 1763100000000 + turn,
  state: null,
  host: null,
  terminal: null,
  ...extra,
});
const tree = {
  root: "claude:aaaa",
  focus: "claude:bbbb",
  nodes: [
    node("claude:aaaa", 1, null, null, 0, "Plan the release\nwith notes", { host: "herdr", terminal: "t1" }),
    node("claude:bbbb", 1, "claude:aaaa#1", "forked", 1, "Try the other layout", { host: "herdr", terminal: "t2" }),
    node("claude:bbbb", 2, "claude:bbbb#1", "continues", 1, "Now the tests", { host: "herdr", terminal: "t2", state: "working" }),
    node("claude:cccc", 1, "claude:bbbb#2", "subagent", 2, "Find the flaky test"),
    node("claude:aaaa", 2, "claude:aaaa#1", "continues", 0, "", { host: "herdr", terminal: "t1" }),
    node("codex:dddd", 1, "claude:aaaa#2", "started", 1, "Write the docs", { host: "tmux", terminal: "%3", state: "idle" }),
    node("claude:aaaa", 3, "claude:aaaa#2", "continues", 0, "Ship it", { host: "herdr", terminal: "t1", state: "done" }),
  ],
};

// Markers: only a branch's first turn has one; a kind added later shows as named.
assert.equal(edgeMarker(null), "");
assert.equal(edgeMarker("continues"), "");
assert.equal(edgeMarker("forked"), "⑂ forked");
assert.equal(edgeMarker("subagent"), "↳ subagent");
assert.equal(edgeMarker("started"), "↗ started");
assert.equal(edgeMarker("resumed"), "resumed");

// The prompt's first non-empty line, cut short.
assert.equal(promptLine("\n  Hello\nworld"), "Hello");
assert.equal(promptLine(""), "(empty prompt)");
assert.equal(promptLine(null), "(empty prompt)");
assert.equal(promptLine("x".repeat(130)).length, 120);
assert.ok(promptLine("x".repeat(130)).endsWith("…"));

// Lines in the CLI's order, indented by depth, the badge on a session's last turn only.
const lines = treeLines(tree);
assert.deepEqual(
  lines.map((l) => `${"  ".repeat(l.depth)}${l.marker ? `${l.marker} ` : ""}${l.label}${l.state ? ` [${l.state}]` : ""}${l.mine ? " *" : ""}`),
  [
    "#1  Plan the release",
    "  ⑂ forked #1  Try the other layout *",
    "  #2  Now the tests [working] *",
    "    ↳ subagent #1  Find the flaky test",
    "#2  (empty prompt)",
    "  ↗ started #1  Write the docs [idle]",
    "#3  Ship it [done]",
  ],
);
assert.deepEqual(lines.map((l) => l.last), [false, false, true, true, false, true, true]);

// A state on a turn that isn't the session's last is not shown.
assert.equal(treeLines({ focus: "a:1", nodes: [node("a:1", 1, null, null, 0, "x", { state: "done" }), node("a:1", 2, "a:1#1", "continues", 0, "y")] })[0].state, null);

// The pane's own session, when given, wins over `focus`.
assert.deepEqual(treeLines(tree, "claude:aaaa").filter((l) => l.mine).map((l) => l.node.id), ["claude:aaaa#1", "claude:aaaa#2", "claude:aaaa#3"]);

// Clicks: the pane's own session opens the turn; another session in a Herdr terminal focuses
// it; one with no terminal, or run outside Herdr, does nothing.
const at = (id) => tree.nodes.find((n) => n.id === id);
assert.deepEqual(nodeAction(at("claude:bbbb#2"), tree), { turn: 2 });
assert.deepEqual(nodeAction(at("claude:aaaa#3"), tree), { terminal: "t1" });
assert.equal(nodeAction(at("claude:cccc#1"), tree), null);
assert.equal(nodeAction(at("codex:dddd#1"), tree), null);
assert.deepEqual(nodeAction(at("claude:aaaa#1"), tree, "claude:aaaa"), { turn: 1 });
assert.equal(nodeAction(null, tree), null);

// A terminal with no host named counts as Herdr's, as in Live.
assert.equal(nodeTerminal({ terminal: "t9", host: null }), "t9");
assert.equal(nodeTerminal({ terminal: "t9", host: "tmux" }), null);
assert.equal(nodeTerminal({ terminal: null, host: "herdr" }), null);

// A session with no branches: a straight line.
const line = { root: "codex:e", focus: "codex:e", nodes: [node("codex:e", 1, null, null, 0, "a"), node("codex:e", 2, "codex:e#1", "continues", 0, "b", { state: "idle" })] };
assert.deepEqual(treeLines(line).map((l) => [l.depth, l.marker, l.state]), [[0, "", null], [0, "", "idle"]]);

// Counts, and an empty or odd answer.
assert.equal(treeCounts(tree), "4 sessions · 7 turns");
assert.equal(treeCounts(line), "1 session · 2 turns");
assert.deepEqual(treeLines(null), []);
assert.deepEqual(treeLines({ nodes: "?" }), []);
assert.equal(treeLines({ nodes: [node("x:1", 1, null, null, -2, "a")] })[0].depth, 0);

console.log("threadtree.test.mjs: ok");
