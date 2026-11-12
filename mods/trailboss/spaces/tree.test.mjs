// node mods/trailboss/spaces/tree.test.mjs
import assert from "node:assert/strict";
import { layoutTree, spaceOrder, canMoveInto, subtree, reorder, needsTip } from "./tree.js";

const row = (id, status = null) => ({ w: { id, status }, i: 0, g: null, tree: null });
const rows = [row("a"), row("b", "working"), row("c", "blocked"), row("d"), row("e")];
const state = {
  folders: [
    { id: "f1", name: "Clients", parent: null, folded: false },
    { id: "f2", name: "Acme", parent: "f1", folded: false },
    { id: "f3", name: "Old", parent: null, folded: true },
  ],
  spaces: {},
};
const placed = { a: "f1", b: "f2", c: "f3", d: null, e: "gone" };
const show = ({ items, rest }) => [
  ...items.map((x) => (x.kind === "folder" ? `${"  ".repeat(x.depth)}[${x.folder.name} ${x.count}${x.working ? ` w${x.working}` : ""}${x.needs ? " !" : ""}]` : `${"  ".repeat(x.depth)}${x.row.w.id}`)),
  ...rest.map((r) => `- ${r.w.id}`),
];

// Subfolders before their spaces; a folded folder hides its spaces but still says one needs
// you; spaces in no folder (or a folder that's gone) come after.
assert.deepEqual(show(layoutTree(rows, state, placed)), [
  "[Clients 2 w1]",
  "  [Acme 1 w1]",
  "    b",
  "  a",
  "[Old 1 !]",
  "- d",
  "- e",
]);

// A folder's most urgent status: blocked before working.
assert.deepEqual(layoutTree(rows, state, placed).items.filter((x) => x.kind === "folder").map((x) => x.status), ["working", "working", "blocked"]);

// Focus shows one folder alone, from depth 0, with nothing else.
assert.deepEqual(show(layoutTree(rows, state, placed, "f2")), ["[Acme 1 w1]", "  b"]);
assert.deepEqual(show(layoutTree(rows, state, placed, "nope")).length, 7, "an unknown focus shows everything");

// No folders at all: Herdr's list as it was.
assert.deepEqual(show(layoutTree(rows, { folders: [] }, {})), rows.map((r) => `- ${r.w.id}`));

// Herdr's order follows the list, folded folders included.
assert.deepEqual(spaceOrder(rows, state, placed).map((r) => r.w.id), ["b", "a", "c", "d", "e"]);

// Moving folders: not into itself or a folder inside it, not past four levels.
const deep = {
  folders: [
    { id: "a", parent: null }, { id: "b", parent: "a" }, { id: "c", parent: "b" },
    { id: "x", parent: null }, { id: "y", parent: "x" },
  ],
};
assert.deepEqual(subtree(deep, "a"), ["a", "b", "c"]);
assert.equal(canMoveInto(deep, "a", "c"), false);
assert.equal(canMoveInto(deep, "a", "a"), false);
assert.equal(canMoveInto(deep, "x", "b"), true, "two levels under the second: four");
assert.equal(canMoveInto(deep, "x", "c"), false, "two levels under the third: five");
assert.equal(canMoveInto(deep, "c", null), true);

// Moving a folder up or down among the folders beside it (others may sit in between).
const sibs = { folders: [{ id: "a", parent: null }, { id: "k", parent: "a" }, { id: "b", parent: null }, { id: "c", parent: null }] };
const f = (id) => sibs.folders.find((x) => x.id === id);
assert.deepEqual(reorder(sibs, f("a"), 1), ["move", "a", "--top", "--before", "c"]);
assert.deepEqual(reorder(sibs, f("b"), 1), ["move", "b", "--top"], "down to the end: last");
assert.deepEqual(reorder(sibs, f("c"), -1), ["move", "c", "--top", "--before", "b"]);
assert.equal(reorder(sibs, f("a"), -1), null, "already first");
assert.equal(reorder(sibs, f("c"), 1), null, "already last");
assert.equal(reorder(sibs, f("k"), 1), null, "alone in its folder");
assert.deepEqual(reorder({ folders: [{ id: "x", parent: "a" }, { id: "y", parent: "a" }] }, { id: "y", parent: "a" }, -1), ["move", "y", "--into", "a", "--before", "x"]);

// The status tooltip: why each agent in a space's terminals needs you, as the block shared it.
const sp = [
  { id: "s1", name: "api", tabs: [{ id: "tab1" }, { id: "tab2" }] },
  { id: "s2", name: "web", tabs: [{ id: "tab3" }] },
];
const ps = [
  { tab: "tab1", terminal: "t1" },
  { tab: "tab2", terminal: "t2" },
  { tab: "tab2", terminal: null },
  { tab: "tab3", terminal: "t3" },
];
const needs = { t1: [{ agent: "codex", why: "Run a command" }], t3: [{ agent: "claude", why: "Plan to approve" }] };
assert.equal(needsTip([sp[0]], ps, needs), "codex needs you: Run a command");
assert.equal(needsTip(sp, ps, needs, true), "api · codex needs you: Run a command\nweb · claude needs you: Plan to approve");
assert.equal(needsTip([sp[0]], ps, {}), null);
assert.equal(needsTip([sp[0]], ps, undefined), null);
// A folder's rollup carries its spaces, for its tooltip.
assert.deepEqual(layoutTree(rows, state, placed).items.find((x) => x.folder?.id === "f3").spaces.map((w) => w.id), ["c"]);

console.log("spaces tree: ok");
