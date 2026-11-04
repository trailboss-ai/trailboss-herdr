// node integrations/herdr/mods/trailboss/cli.test.mjs
import assert from "node:assert/strict";
import { older, cliProblem, problemText, hasBlock } from "./cli.js";

assert.equal(older("0.3.0", "0.4.0"), true);
assert.equal(older("0.4.0", "0.4.0"), false);
assert.equal(older("0.10.0", "0.9.9"), false);
assert.equal(older("0.9.9", "0.10.0"), true);
assert.equal(older("1.0", "1.0.1"), true);
assert.equal(older("0.4.0-rc1", "0.4.0"), false);

const needs = { version: "0.4.0", api: 1 };
assert.equal(cliProblem(null, null, needs), "missing");
assert.equal(cliProblem("trailboss", null, needs), "old"); // predates `version`
assert.equal(cliProblem("trailboss", { version: "0.3.9", api: 1 }, needs), "old");
assert.equal(cliProblem("trailboss", { version: "0.4.0", api: 1 }, needs), null);
assert.equal(cliProblem("trailboss", { version: "0.12.0", api: 1 }, needs), null);
assert.equal(cliProblem("trailboss", { version: "1.0.0", api: 2 }, needs), "newer-api");

assert.equal(problemText("missing", null, needs), "Trailboss isn't installed");
assert.equal(problemText("old", { version: "0.3.9" }, needs), "Trailboss 0.4.0 needed (have 0.3.9)");
assert.equal(problemText("old", null, needs), "A newer Trailboss is needed");

const block = (content) => ({ type: "block", content });
assert.equal(hasBlock({ type: "column", children: [{ type: "row", children: [block({ mod: "trailboss" })] }] }), true);
assert.equal(hasBlock({ type: "column", children: [block({ mod: "trailboss", props: { view: "files" } })] }), false);
assert.equal(hasBlock({ type: "column", children: [block({ mod: "workspace-status" })] }), false);

console.log("cli: ok");
