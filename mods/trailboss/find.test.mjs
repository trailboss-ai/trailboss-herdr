// node integrations/herdr/mods/trailboss/find.test.mjs
import assert from "node:assert/strict";
import { findAll, replaceNext, replaceAll } from "./find.js";

const t = "let a = 1;\nlet B = a + a;\n// a.b\n";
assert.deepEqual(findAll(t, "a").map((m) => [m.line, m.col]), [[1, 5], [2, 9], [2, 13], [3, 4]]);
assert.equal(findAll(t, "A", { caseSensitive: true }).length, 0);
assert.equal(findAll(t, "b").length, 2, "case-insensitive by default");
assert.equal(findAll(t, "a.b").length, 1, "plain text: the dot is literal");
assert.equal(findAll(t, "a.b", { regex: true }).length, 1);
assert.equal(findAll(t, "let \\w", { regex: true })[1].text, "let B = a + a;");
assert.throws(() => findAll(t, "(", { regex: true }), "a bad regex is an error");
assert.deepEqual(findAll(t, "x*", { regex: true }), [], "empty matches don't loop forever");
assert.deepEqual(findAll(t, ""), []);

let r = replaceNext(t, "a", "z", {}, 0);
assert.equal(r.text.split("\n")[0], "let z = 1;");
r = replaceNext(r.text, "a", "z", {}, r.at);
assert.equal(r.text.split("\n")[1], "let B = z + a;");
assert.equal(r.line, 2);
assert.equal(replaceNext("x", "a", "z", {}), null);

assert.deepEqual(replaceAll(t, "a", "q", { caseSensitive: true }), { text: t.replaceAll("a", "q"), count: 4 });
assert.equal(replaceAll("f(1) f(22)", "f\\((\\d+)\\)", "g[$1]", { regex: true }).text, "g[1] g[22]", "regex groups");
assert.equal(replaceAll("a.a", ".", "-", {}).text, "a-a", "plain dot only");
console.log("find.test.mjs: ok");
