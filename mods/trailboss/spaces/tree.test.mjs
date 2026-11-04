// node mods/trailboss/spaces/tree.test.mjs
import assert from "node:assert/strict";
import { layoutTree, spaceOrder, canMoveInto, subtree } from "./tree.js";

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

console.log("spaces tree: ok");
