// node integrations/herdr/mods/trailboss/fleet/tree.test.mjs
import assert from "node:assert/strict";
import { liveTree, liveList } from "./tree.js";

const show = (lines) => lines.map((l) => (l.group ? `[${l.group.name} ${l.group.count}/${l.group.working}]` : `${"  ".repeat(l.depth)}${l.row.where}`));

// Two agents in one repo, one of them with a sub-agent working elsewhere; one agent alone.
const rows = [
  { where: "t1 api", workspace: "/r/api", cwd: "/r/api", status: "working" },
  { where: "t2 api", workspace: "/r/api", cwd: "/r/api/src", status: "idle" },
  { where: "t3 web", cwd: "/r/web", status: "idle" },
  { where: "t4 docs", cwd: "/r/docs", status: "working", parent: "t1 api" },
];
assert.deepEqual(show(liveTree(rows)), ["[api 3/2]", "t1 api", "  t4 docs", "t2 api", "[web 1/0]", "t3 web"]);

// A parent that isn't listed (it ended) leaves the child at the top of its folder.
assert.deepEqual(show(liveTree([{ where: "t5 x", cwd: "/x", parent: "t9 gone" }])), ["[x 1/0]", "t5 x"]);

// A cycle can't hide anyone or loop forever.
const cyc = liveTree([
  { where: "a", cwd: "/a", parent: "b" },
  { where: "b", cwd: "/b", parent: "a" },
]);
assert.deepEqual(show(cyc).filter((s) => !s.startsWith("[")).sort(), ["a", "b"]);

// Lost terminals have no folder: never grouped.
assert.deepEqual(show(liveTree([{ where: "t6" }, { where: "t7" }])), ["t6", "t7"]);

// Inside a folder: needs you, done, working, idle; pinned agents first all the same.
const mixed = [
  { where: "a idle", cwd: "/m", status: "idle" },
  { where: "b working", cwd: "/m", status: "working" },
  { where: "c done", cwd: "/m", status: "done" },
  { where: "d blocked", cwd: "/m", status: "blocked" },
  { where: "e pinned", cwd: "/m", status: "idle", pinned: true },
  { where: "f asked", cwd: "/m", status: "idle", needs: "Should I push?" },
];
assert.deepEqual(show(liveTree(mixed)), ["[m 6/1]", "e pinned", "d blocked", "f asked", "c done", "b working", "a idle"]);
assert.equal(liveTree(mixed)[0].group.needs, 2);

// Folders go by their most urgent agent; a blocked child brings its parent up, and stays
// under it.
const folders = [
  { where: "w1", cwd: "/w", status: "working" },
  { where: "q1", cwd: "/q", status: "idle" },
  { where: "q2", cwd: "/q", status: "idle" },
  { where: "q3", cwd: "/elsewhere", status: "blocked", parent: "q2" },
];
assert.deepEqual(show(liveTree(folders)), ["[q 3/0]", "q2", "  q3", "q1", "[w 1/1]", "w1"]);

// The List view: pinned, then most urgent, else as listed.
assert.deepEqual(
  liveList(mixed).map((l) => l.row.where),
  ["e pinned", "d blocked", "f asked", "c done", "b working", "a idle"],
);

console.log("tree.test.mjs: ok");
