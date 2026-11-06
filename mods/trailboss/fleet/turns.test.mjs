// node mods/trailboss/fleet/turns.test.mjs
import assert from "node:assert/strict";
import { quote, matching, day, lines, codeBlocks } from "./turns.js";

assert.equal(quote("Fixed it.\n\nRun the tests.\n"), "> Fixed it.\n>\n> Run the tests.\n\n");

const turns = [
  { prompt: "fix the login test", reply: "Added a wait." },
  { prompt: "and the docs", reply: "Updated the README." },
];
assert.equal(matching(turns, "").length, 2);
assert.deepEqual(matching(turns, "LOGIN wait"), [turns[0]], "every word, any case, prompt or reply");
assert.deepEqual(matching(turns, "login readme"), []);

assert.match(day("2026-10-01T10:00:00.000Z"), /^2026-10-0[12]$/);
assert.equal(day(null), "");

assert.deepEqual(lines("  a\n\n b \nc\nd", 2), ["a", "b"]);
assert.deepEqual(lines("x".repeat(5), 1, 4), ["xxx…"]);
assert.deepEqual(lines("I created **[GEN-1](https://x/1)**: `ok`\n```sh\n- **Cycle:** 7", 3), ["I created GEN-1: ok", "- Cycle: 7"]);

assert.deepEqual(codeBlocks("Run:\n```sh\ncargo test\n```\nand\n```\nls\n```\n"), ["cargo test", "ls"]);

console.log("thread turns: ok");
