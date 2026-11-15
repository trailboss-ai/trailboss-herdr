// node mods/trailboss/fleet/branch.test.mjs
import assert from "node:assert/strict";
import { words, askable, branchArgs, readBranch, planText } from "./branch.js";

// Shaped like `trailboss --json branch claude:aaaa --at 3 --prompt "…"` (made up), to the schema.
const plan = {
  action: "would branch",
  parent: "claude:aaaa",
  kind: "claude",
  at: 3,
  folder: "/home/user/shop",
  argv: ["claude", "--resume", "aaaa", "--fork-session", "Side question, as of turn 3.\n\n<question>"],
  command: "claude --resume aaaa --fork-session 'Side question, as of turn 3.\n\n<question>'",
  question: true,
  label: "claude branch",
  host: "herdr",
  terminal: null,
  detail: "a fork of claude:aaaa in /home/user/shop, in a new herdr terminal, from turn 3",
};
const started = { ...plan, action: "branched", terminal: "t12" };

// Two words at least; whitespace doesn't count.
assert.equal(words(""), 0);
assert.equal(words(null), 0);
assert.equal(words("  why\n"), 1);
assert.equal(words("why  this?\tnow"), 3);
assert.equal(askable("update"), false);
assert.equal(askable("why this"), true);

// The plan, then the start; the question trimmed and kept whole as one argument.
assert.deepEqual(branchArgs("claude:aaaa", 3, "  why this way? "), ["branch", "claude:aaaa", "--at=3", "--prompt=why this way?"]);
assert.deepEqual(branchArgs("claude:aaaa", 3, "why this way?", true), ["branch", "claude:aaaa", "--at=3", "--prompt=why this way?", "--yes"]);
assert.deepEqual(branchArgs("claude:aaaa", null, "-v please", false, "side"), ["branch", "claude:aaaa", "--prompt=-v please", "--name=side"]);

// The plan's JSON, read whatever the exit code.
assert.deepEqual(readBranch({ code: 0, stdout: JSON.stringify([plan]), stderr: "" }), { row: plan });
assert.deepEqual(readBranch({ code: 2, stdout: JSON.stringify([plan]) + "\n", stderr: "" }), { row: plan });
assert.deepEqual(readBranch({ code: 0, stdout: JSON.stringify([started]), stderr: "" }), { row: started });

// A refusal is an error in the CLI's words.
assert.deepEqual(readBranch({ code: 1, stdout: "", stderr: "trailboss: there's no turn 9: the session has 4 (`trailboss thread`)\n" }), {
  error: "there's no turn 9: the session has 4 (`trailboss thread`)",
});
assert.deepEqual(readBranch({ code: 1, stdout: "", stderr: "trailboss: a question must be at least two words\n" }), { error: "a question must be at least two words" });
assert.deepEqual(readBranch({ code: 2, stdout: "", stderr: "error: unexpected argument '-x' found\n\n  tip: use '-- -x'\n\nUsage: trailboss branch [OPTIONS] <SESSION>\n\nFor more information, try '--help'.\n" }), {
  error: "unexpected argument '-x' found",
});
assert.deepEqual(readBranch({ code: 1, stdout: "", stderr: "" }), { error: "trailboss branch failed (exit 1)" });
assert.deepEqual(readBranch({ code: 0, stdout: "[]", stderr: "" }), { error: "trailboss branch failed (exit 0)" });
assert.deepEqual(readBranch(null), { error: "trailboss branch failed (exit ?)" });


// The card's lines; an action this mod doesn't know shows as is.
assert.deepEqual(planText(plan), { detail: plan.detail, command: plan.command });
assert.deepEqual(planText(started), { detail: `branched: ${plan.detail}`, command: plan.command });
assert.deepEqual(planText({ action: "queued", detail: "x" }), { detail: "queued: x", command: "" });
assert.deepEqual(planText(null), { detail: "", command: "" });

console.log("branch.test.mjs: ok");
