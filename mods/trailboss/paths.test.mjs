// node integrations/herdr/mods/trailboss/paths.test.mjs
import assert from "node:assert/strict";
import { parentOf, within, dropDest } from "./paths.js";

const R = "/repo";
assert.equal(parentOf("/repo/a/b.txt"), "/repo/a");
assert.equal(parentOf("/a"), "/");

assert.equal(within(R, R, "src/new.rs"), "/repo/src/new.rs");
assert.equal(within(R, "/repo/src", "./x.rs"), "/repo/src/x.rs");
assert.equal(within(R, R, "a//b"), "/repo/a/b");
for (const bad of ["../escape", "a/../../x", "..", "src/.."]) assert.equal(within(R, R, bad), null, bad);
assert.equal(within(R, "/elsewhere", "x"), null);

assert.equal(dropDest(R, "/repo/a.txt", "/repo/src"), "/repo/src/a.txt");
assert.equal(dropDest(R, "/repo/src/a.txt", R), "/repo/a.txt");
assert.equal(dropDest(R, "/repo/src/a.txt", "/repo/src"), null, "same folder");
assert.equal(dropDest(R, "/repo/src", "/repo/src"), null, "onto itself");
assert.equal(dropDest(R, "/repo/src", "/repo/src/deep"), null, "into its own subfolder");
assert.equal(dropDest(R, "/repo/srcx", "/repo/src"), "/repo/src/srcx", "a name prefix isn't a parent");
assert.equal(dropDest(R, "/repo/a.txt", "/other"), null, "outside the folder shown");
console.log("paths.test.mjs: ok");
