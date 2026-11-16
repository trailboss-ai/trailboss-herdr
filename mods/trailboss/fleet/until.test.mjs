// node mods/trailboss/fleet/until.test.mjs
import assert from "node:assert/strict";
import { LS_ARGS, readLoops, loopsByRow, untilState, untilChip, untilTip, untilActions, untilDone } from "./until.js";

// `trailboss --json until ls`, as in its specification's example.
const loops = [
  {
    "id": 48213,
    "agent": "claude",
    "session": "0b9d6a1e-5f2c-4c1e-9a77-3d1f2e8c4b10",
    "terminal": "herdr:t2f",
    "cwd": "/home/user/shop",
    "check": "cargo test",
    "state": "running",
    "requested": null,
    "round": 2,
    "last_passed": false,
    "cost_usd": 0.84,
    "minutes": 12,
    "paused_until": null,
    "log": null
  },
  {
    "id": 48390,
    "agent": "codex",
    "session": "rollout-7c1d",
    "terminal": "tmux:work:2.1",
    "cwd": "/home/user/api",
    "check": "npm test",
    "state": "waiting",
    "requested": "pause",
    "round": 1,
    "last_passed": false,
    "cost_usd": 0.2,
    "minutes": 4,
    "paused_until": 1790000000,
    "log": "/home/user/.local/share/trailboss/until/1789996400000.log"
  }
];
const [running, waiting] = loops;
assert.deepEqual(LS_ARGS, ["until", "ls"]);

// Anything not a loop is dropped; not an array is none.
assert.equal(readLoops([...loops, null, { agent: "claude" }, { id: "7", agent: "x" }]).length, 2);
assert.deepEqual(readLoops(null), []);
assert.deepEqual(readLoops({ error: "unknown command" }), []);

// By agent and session first, else by terminal; one row per loop.
const bySession = { where: "t9 shop", host: "herdr", terminal: "t9", agent: "claude", session: "0b9d6a1e-5f2c-4c1e-9a77-3d1f2e8c4b10" };
const sameTerminal = { where: "t2f shop", host: "herdr", terminal: "t2f", agent: "claude", session: "other" };
const byTerminal = { where: "work:2.1", host: "tmux", terminal: "work:2.1", agent: "codex", session: null };
const otherAgent = { where: "t4", host: "herdr", terminal: "t4", agent: "codex", session: "0b9d6a1e-5f2c-4c1e-9a77-3d1f2e8c4b10" };
const noAgent = { where: "t7", host: "herdr", terminal: "t7", agent: null, session: null };
let m = loopsByRow([sameTerminal, bySession, byTerminal, otherAgent, noAgent], loops);
assert.equal(m.get(bySession), running);
assert.equal(m.get(sameTerminal), undefined); // its loop went to the session's row
assert.equal(m.get(byTerminal), waiting);
assert.equal(m.get(otherAgent), undefined);
assert.equal(m.size, 2);
// Without the session's row, the terminal finds it.
m = loopsByRow([sameTerminal], loops);
assert.equal(m.get(sameTerminal), running);
// A session already AGENT:ID.
m = loopsByRow([{ agent: "codex", session: "codex:rollout-7c1d", terminal: null }], loops);
assert.equal(m.size, 1);
// Nothing to match, or `until ls` failed.
assert.equal(loopsByRow([bySession], []).size, 0);
assert.equal(loopsByRow([bySession], undefined).size, 0);
assert.equal(loopsByRow(null, loops).size, 0);

// The chip: round, how it's going, cost.
assert.deepEqual(untilChip(running), ["until: round 2 · failing · $0.84", "blocked"]);
assert.deepEqual(untilChip(waiting), ["until: round 1 · pausing · $0.20", "dim"]);
assert.deepEqual(untilChip({ ...running, last_passed: true }), ["until: round 2 · passing · $0.84", "done"]);
assert.deepEqual(untilChip({ ...running, round: 0, last_passed: null, cost_usd: 0 }), ["until: round 0 · running · $0.00", "working"]);
assert.equal(untilState({ ...running, state: "paused" })[0], "paused");
assert.equal(untilState({ ...running, state: "paused", requested: "stop" })[0], "stopping");
assert.equal(untilState({ ...running, requested: "stop" })[0], "stopping");
assert.equal(untilState({ ...running, state: "stopped" })[0], "stopping");
assert.equal(untilState({ ...running, state: "checking" })[0], "checking");
assert.equal(untilState({ ...waiting, requested: null })[0], "waiting");

// The tooltip: the check, its folder, minutes; while waiting, how long is left.
assert.equal(untilTip(running), "until cargo test\n/home/user/shop\n12 min running");
const now = (1790000000 - 25 * 60) * 1000;
assert.equal(untilTip({ ...waiting, requested: null }, now), "until npm test\n/home/user/api\n4 min running · waits 25m more");
assert.equal(untilTip({ ...waiting, requested: null }, 1790000001000), "until npm test\n/home/user/api\n4 min running");

// Actions only for what the loop can take now.
const labels = (l) => untilActions(l).map(([label]) => label);
assert.deepEqual(labels(running), ["Pause", "Stop"]);
assert.deepEqual(untilActions(running).map(([, args]) => args), [["until", "pause", "48213"], ["until", "stop", "48213"]]);
assert.deepEqual(labels(waiting), ["Stop"]); // a pause is already asked
assert.deepEqual(labels({ ...running, state: "paused" }), ["Resume", "Stop"]);
assert.deepEqual(labels({ ...running, state: "checking" }), ["Pause", "Stop"]);
assert.deepEqual(labels({ ...running, requested: "stop" }), []);
assert.deepEqual(labels({ ...running, state: "stopped" }), []);

// The notification after a click names the loop's terminal (without its host) and round.
assert.equal(untilDone({ terminal: "herdr:t12", round: 3 }, "Stop"), "Stopped the until loop on t12 (round 3)");
assert.equal(untilDone({ terminal: null, round: null }, "Pause"), "Paused the until loop");

console.log("until ok");
