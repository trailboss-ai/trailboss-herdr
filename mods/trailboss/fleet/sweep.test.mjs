// node mods/trailboss/fleet/sweep.test.mjs
import assert from "node:assert/strict";
import { sweepParent, heading, nextFor, sweepGroups, sweepCounts, stateTone, nextTone, prBadge, firstLine, terminalFor } from "./sweep.js";

// Live's bare session id gets its agent; one already AGENT:ID stays; none, null.
assert.equal(sweepParent({ agent: "claude", session: "5b2c" }), "claude:5b2c");
assert.equal(sweepParent({ agent: "claude", session: "codex:019a" }), "codex:019a");
assert.equal(sweepParent({ agent: "claude", session: null }), null);
assert.equal(sweepParent(null), null);

// Rows shaped like `trailboss --json sweep`'s (made up).
const P = "claude:p";
const data = {
  parent: P,
  rows: [
    { kind: "task", name: "task 3: Fix the login", n: 3, session: "claude:a", depth: 0, state: "ready" },
    { kind: "task", name: "task 4: Add a filter", n: 4, session: "codex:b", depth: 0, state: "needs you" },
    { kind: "agent", name: "reviewer", n: null, session: "claude:c", depth: 0, state: "working" },
    { kind: "agent", name: "notes", n: null, session: null, depth: 0, state: "ended" },
    { kind: "agent", name: "idle one", n: null, session: "claude:d", depth: 1, state: "done" },
    { kind: "task", name: "task 5: Notes", n: 5, session: null, depth: 1, state: "to do" },
    { kind: "agent", name: "odd", n: null, session: "claude:e", depth: 1, state: "paused" },
  ],
  next: [
    { kind: "decision", name: "task 4: Add a filter", n: 4, session: "codex:b", text: "answer it: approve: cargo test" },
    { kind: "decision", name: "task 3: Fix the login", n: 3, session: "claude:a", text: "merge PR #41" },
    { kind: "decision", name: "task 5: Notes", n: 5, session: null, text: "start one" },
    { kind: "wait", name: "reviewer", n: null, session: "claude:c", text: "working" },
    { kind: "info", name: "idle one", n: null, session: "claude:d", text: "at rest" },
    { kind: "later", name: "odd", n: null, session: "claude:e", text: "a kind added later" },
  ],
  notes: [],
};

// A task by number (even when its session matches another step), an agent by session.
assert.equal(nextFor(data.rows[0], data.next).text, "merge PR #41");
assert.equal(nextFor(data.rows[0], data.next).i, 1);
assert.equal(nextFor(data.rows[2], data.next).kind, "wait");
assert.equal(nextFor(data.rows[3], data.next), null);
assert.equal(nextFor(data.rows[0], null), null);
// With neither number nor session, by name, and only against steps without them.
assert.equal(nextFor({ name: "x", n: null, session: null }, [{ kind: "info", name: "x", n: 9, session: null, text: "" }]), null);
assert.equal(nextFor({ name: "x", n: null, session: null }, [{ kind: "info", name: "x", n: null, session: null, text: "t" }]).text, "t");

// Decisions in `next`'s order, then waits, info, a later kind, then rows with nothing next.
const g = sweepGroups(data);
assert.deepEqual(
  g.map((x) => [x.kind, x.rows.map((r) => r.row.name)]),
  [
    ["decision", ["task 4: Add a filter", "task 3: Fix the login", "task 5: Notes"]],
    ["wait", ["reviewer"]],
    ["info", ["idle one"]],
    ["later", ["odd"]],
    ["none", ["notes"]],
  ],
);
assert.deepEqual(sweepGroups({ rows: [], next: [] }), []);
assert.deepEqual(sweepGroups(null), []);

assert.equal(sweepCounts(g), "3 decisions · 1 waiting");
assert.equal(sweepCounts(sweepGroups({ rows: [data.rows[1]], next: data.next })), "1 decision");
assert.equal(sweepCounts([]), "");

assert.deepEqual(["decision", "wait", "info", "later", "none"].map(heading), ["Your decision", "Waiting", "At rest", "Later", "Nothing next"]);
assert.deepEqual(["decision", "wait", "info", "x"].map(nextTone), ["blocked", "working", "dim", "dim"]);
assert.deepEqual(
  ["needs you", "working", "ready", "done", "ended", "missing", "to do", "new"].map(stateTone),
  ["blocked", "working", "done", "done", "dim", "dim", "idle", "muted"],
);

// PR badges: the most pressing thing sets the tone.
const pr = { number: 41, url: "https://example.com/pull/41", state: "open", draft: false, ci: "passing", mergeable: true, conflicts: false, unresolved_threads: 0 };
assert.deepEqual(prBadge(pr), { text: "#41 · CI ✓", tone: "done", url: "https://example.com/pull/41" });
assert.deepEqual(prBadge({ ...pr, ci: "failing" }), { text: "#41 · CI ✗", tone: "blocked", url: pr.url });
assert.equal(prBadge({ ...pr, ci: "pending" }).tone, "working");
assert.deepEqual(prBadge({ ...pr, ci: "none", draft: true }), { text: "#41 · draft", tone: "muted", url: pr.url });
assert.deepEqual(prBadge({ ...pr, conflicts: true, unresolved_threads: 2 }), { text: "#41 · CI ✓ · conflicts · 2 threads", tone: "blocked", url: pr.url });
assert.equal(prBadge({ ...pr, unresolved_threads: 1 }).text, "#41 · CI ✓ · 1 thread");
assert.equal(prBadge({ ...pr, unresolved_threads: 1 }).tone, "blocked");
assert.deepEqual(prBadge({ ...pr, state: "merged" }), { text: "#41 · merged · CI ✓", tone: "done", url: pr.url });
assert.equal(prBadge({ ...pr, state: "closed", ci: "failing" }).tone, "muted");
// A CI state added later shows as is; unknowns (null) add nothing.
assert.equal(prBadge({ ...pr, ci: "skipped", conflicts: null, unresolved_threads: null }).text, "#41 · skipped");
assert.equal(prBadge(null), null);

assert.equal(firstLine("\n  Fixed it.\nTests pass."), "Fixed it.");
assert.equal(firstLine(null), "");

// Focus only a Herdr terminal Live knows for the row's session.
const live = [
  { agent: "claude", session: "a", terminal: "t9", host: "herdr" },
  { agent: "claude", session: "c", terminal: "w1", host: "vscode" },
  { agent: "codex", session: "b", terminal: "t10" },
];
assert.equal(terminalFor(data.rows[0], live), "t9");
assert.equal(terminalFor(data.rows[1], live), "t10");
assert.equal(terminalFor(data.rows[2], live), null);
assert.equal(terminalFor(data.rows[3], live), null);
assert.equal(terminalFor(data.rows[0], null), null);

console.log("sweep ok");
