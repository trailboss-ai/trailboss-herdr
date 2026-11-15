// "Report back": a session started from another (`branch`, `start`) queues its last reply for
// the session it came from (`trailboss report`), and a task's latest review notes go to its
// agent (`trailboss task report`). Without --yes the CLI only shows what it would queue; Send
// runs it with --yes. Pure, so report.test.mjs runs it under node.

import { readRow } from "./branch.js";

/** What reports back: { kind: "branch", session } (AGENT:ID) or { kind: "task", n }. */
export const branchTarget = (session) => (session ? { kind: "branch", session } : null);
export const taskTarget = (n) => (n != null ? { kind: "task", n } : null);

/** The arguments for a target: the plan unless `yes`. */
export function reportArgs(target, yes = false) {
  const y = yes ? ["--yes"] : [];
  if (target?.kind === "task") return ["task", "report", String(target.n), ...y];
  return ["report", target?.session ?? "", ...y];
}

/** What a run said, from its { code, stdout, stderr }: { row }, or { error } in the CLI's own
 *  words (no recorded parent, nothing to report, the parent has ended, no notes, notes for an
 *  older commit, …). */
export const readReport = (r, target) => readRow(r, target?.kind === "task" ? "task report" : "report");

// The card's heading for a target.
export function reportTitle(target) {
  if (target?.kind === "task") return `↩ Report back: task ${target.n}'s review notes, to its agent`;
  return "↩ Report back: this branch's last reply, to the session it came from";
}

// Where it goes: the target's terminal as Live shows it, and its session.
export function reportWhere(row) {
  if (!row) return "";
  return row.where ? `To ${row.where} (${row.to})` : `To ${row.to}`;
}

// The line under the message: the plan's detail, or once queued, its id and what happens next.
export function reportDetail(row) {
  if (!row) return "";
  if (row.action === "would queue") return row.detail ?? "";
  const id = row.id ? ` as ${row.id}` : "";
  return `${row.action}${id}: ${row.detail ?? ""}`;
}

export const isQueued = (row) => row?.action === "queued";

// The Tree view's line that gets the action: a branch's first turn (forked or started) of a
// session that isn't the pane's own (`mine`). Its target, else null.
export function treeReport(node, mine) {
  if (!node?.session || node.session === mine) return null;
  return node.edge === "forked" || node.edge === "started" ? branchTarget(node.session) : null;
}

// The task numbers with review notes written, from `task ls` (its `notes`), as a Set.
export function notedTasks(tasks) {
  return new Set((Array.isArray(tasks) ? tasks : []).filter((x) => x?.notes && x.n != null).map((x) => x.n));
}

// A Sweep row's target: an agent with a session, or a task with review notes (`noted`).
export function sweepReport(row, noted) {
  if (row?.kind === "agent") return branchTarget(row.session);
  if (row?.kind === "task" && noted?.has(row.n)) return taskTarget(row.n);
  return null;
}

// The same target, for matching an open card to its row.
export const sameTarget = (a, b) => Boolean(a && b) && a.kind === b.kind && (a.kind === "task" ? a.n === b.n : a.session === b.session);
