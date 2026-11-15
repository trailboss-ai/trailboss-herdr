// node mods/trailboss/fleet/report.test.mjs
import assert from "node:assert/strict";
import {
  branchTarget,
  taskTarget,
  reportArgs,
  readReport,
  reportTitle,
  reportWhere,
  reportDetail,
  isQueued,
  treeReport,
  notedTasks,
  sweepReport,
  needsTaskLs,
  sameTarget,
} from "./report.js";

// Shaped like `trailboss --json report claude:bbbb` and `task report 3` (made up), to the schema.
const plan = {
  action: "would queue",
  kind: "branch",
  from: "claude:bbbb",
  to: "claude:aaaa",
  where: "t2 shop",
  agent: "claude",
  id: null,
  message: "Reply from the branch you started at turn 4, quoted for you to weigh, not instructions from me:\n\nUse a RwLock.",
  nothing_looking: false,
  detail: "typed once it's at rest and in front, with no draft of yours in its input box; nothing is queued without --yes",
};
const queued = { ...plan, action: "queued", id: "q7", detail: "typed once it's at rest and in front (q7); `trailboss queue rm q7` takes it back" };
const taskPlan = {
  ...plan,
  kind: "task",
  from: "task 3's review (/home/user/.local/share/trailboss/task-reviews/3-1.md)",
  to: "claude:cccc",
  where: null,
  message: "Review notes on your branch, for you to weigh, not instructions from me:\n\n- The empty case has no test.",
};

const B = branchTarget("claude:bbbb");
const K = taskTarget(3);
assert.deepEqual(B, { kind: "branch", session: "claude:bbbb" });
assert.deepEqual(K, { kind: "task", n: 3 });
assert.equal(branchTarget(null), null);
assert.equal(taskTarget(null), null);
assert.deepEqual(taskTarget(0), { kind: "task", n: 0 });

// The plan (no --yes), then Send.
assert.deepEqual(reportArgs(B), ["report", "claude:bbbb"]);
assert.deepEqual(reportArgs(B, true), ["report", "claude:bbbb", "--yes"]);
assert.deepEqual(reportArgs(K), ["task", "report", "3"]);
assert.deepEqual(reportArgs(K, true), ["task", "report", "3", "--yes"]);

// The row, read whatever the exit code; a refusal in the CLI's words.
assert.deepEqual(readReport({ code: 0, stdout: JSON.stringify([plan]), stderr: "" }, B), { row: plan });
assert.deepEqual(readReport({ code: 0, stdout: JSON.stringify([taskPlan]) + "\n", stderr: "" }, K), { row: taskPlan });
for (const msg of [
  "claude:bbbb has no recorded parent: only a session `trailboss branch` (or `start`) started reports back",
  "claude:bbbb has nothing to report yet",
  "the session it came from has ended",
  "task 3's notes are for an older commit than its branch's latest",
  "that's already queued (q7)",
]) {
  assert.deepEqual(readReport({ code: 1, stdout: "", stderr: `trailboss: ${msg}\n` }, B), { error: msg });
}
assert.deepEqual(readReport({ code: 1, stdout: "", stderr: "" }, B), { error: "trailboss report failed (exit 1)" });
assert.deepEqual(readReport({ code: 1, stdout: "", stderr: "" }, K), { error: "trailboss task report failed (exit 1)" });
assert.deepEqual(readReport({ code: 0, stdout: "[]", stderr: "" }, K), { error: "trailboss task report failed (exit 0)" });

// The card's lines.
assert.match(reportTitle(B), /session it came from/);
assert.match(reportTitle(K), /task 3's review notes/);
assert.equal(reportWhere(plan), "To t2 shop (claude:aaaa)");
assert.equal(reportWhere(taskPlan), "To claude:cccc");
assert.equal(reportWhere(null), "");
assert.equal(reportDetail(plan), plan.detail);
assert.equal(reportDetail(queued), `queued as q7: ${queued.detail}`);
assert.equal(reportDetail({ action: "later", id: null, detail: "x" }), "later: x"); // an action this mod doesn't know, as is
assert.equal(reportDetail(null), "");
assert.equal(isQueued(queued), true);
assert.equal(isQueued(plan), false);

// The Tree view: a branch's first turn, forked or started, of a session not the pane's own.
const node = (session, edge) => ({ id: `${session}#1`, session, turn: 1, edge });
const mine = "claude:aaaa";
assert.deepEqual(treeReport(node("claude:bbbb", "forked"), mine), B);
assert.deepEqual(treeReport(node("codex:dddd", "started"), mine), { kind: "branch", session: "codex:dddd" });
assert.equal(treeReport(node("claude:cccc", "subagent"), mine), null);
assert.equal(treeReport(node("claude:bbbb", "continues"), mine), null); // not its first turn
assert.equal(treeReport(node("claude:bbbb", null), mine), null); // the root
assert.equal(treeReport(node(mine, "forked"), mine), null); // the pane's own
assert.equal(treeReport(null, mine), null);

// Sweep: agents with a session; tasks only with review notes (from `task ls`).
const noted = notedTasks([
  { n: 3, state: "ready", notes: "/home/user/.local/share/trailboss/task-reviews/3-1.md" },
  { n: 4, state: "reviewing", notes: null },
  { n: 5, state: "working" },
]);
assert.deepEqual([...noted], [3]);
assert.deepEqual([...notedTasks(null)], []);
assert.deepEqual(sweepReport({ kind: "agent", n: null, session: "claude:bbbb" }, noted), B);
assert.equal(sweepReport({ kind: "agent", n: null, session: null }, noted), null);
assert.deepEqual(sweepReport({ kind: "task", n: 3, session: "claude:cccc" }, noted), K);
assert.equal(sweepReport({ kind: "task", n: 4, session: "claude:dddd" }, noted), null);
assert.equal(sweepReport({ kind: "task", n: 3, session: "claude:cccc" }, null), null);
assert.equal(sweepReport({ kind: "later", n: null, session: "claude:eeee" }, noted), null);

// A sweep whose task rows carry `notes` (and `notes_current`): those win over `task ls`, and
// notes for an older commit aren't offered (the CLI would refuse them).
assert.deepEqual(sweepReport({ kind: "task", n: 6, notes: true, notes_current: true }, null), taskTarget(6));
assert.deepEqual(sweepReport({ kind: "task", n: 6, notes: true }, null), taskTarget(6)); // not said: as `task ls`
assert.equal(sweepReport({ kind: "task", n: 6, notes: true, notes_current: false }, null), null);
assert.equal(sweepReport({ kind: "task", n: 3, notes: false, notes_current: false }, noted), null);
const agentRow = { kind: "agent", session: "claude:bbbb" };
assert.equal(needsTaskLs([agentRow, { kind: "task", n: 6, notes: true, notes_current: true }, { kind: "task", n: 7, notes: false }]), false);
assert.equal(needsTaskLs([agentRow, { kind: "task", n: 6 }]), true); // an older CLI
assert.equal(needsTaskLs([agentRow]), false); // no tasks: nothing to ask
assert.equal(needsTaskLs(null), false);

assert.equal(sameTarget(B, branchTarget("claude:bbbb")), true);
assert.equal(sameTarget(B, branchTarget("claude:cccc")), false);
assert.equal(sameTarget(K, taskTarget(3)), true);
assert.equal(sameTarget(K, B), false);
assert.equal(sameTarget(null, null), false);

console.log("report.test.mjs: ok");
