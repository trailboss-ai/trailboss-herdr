// node integrations/herdr/mods/trailboss/fleet/tree.test.mjs
import assert from "node:assert/strict";
import { liveTree } from "./tree.js";

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

console.log("tree.test.mjs: ok");
