// node mods/trailboss/fleet/unread.test.mjs
import assert from "node:assert/strict";
import {
  knowsUnread,
  unreadBadge,
  branchBadge,
  branchTip,
  unreadCount,
  sessionArg,
  seenArgs,
  seenOnFocus,
  markUnreadArgs,
  RECAP_AFTER_MS,
  wantsRecap,
  recapKey,
  recapArgs,
  readRecap,
  recapTip,
  NOTIFIED_FOR_MS,
  seenAfterNotice,
} from "./unread.js";

const now = 1_790_850_000_000;
// `live --json` rows (made up), with and without the unread fields.
const api = {
  agent: "claude", session: "claude:5d1e-synthetic", terminal: "t12", host: "herdr", where: "api",
  unread: true, unread_turns: 3, unread_since_ms: now - 42 * 60_000, branches_unread: 2,
};
const web = { agent: "codex", session: "codex:77aa-synthetic", terminal: "t4", host: "herdr", where: "web", turn_ended_ms: now - 5000, unread: false, unread_turns: 0, unread_since_ms: null, branches_unread: 0 };
const vscode = { agent: "claude", session: "9c0f-synthetic", terminal: "w1", host: "vscode", unread: true, unread_turns: 1, unread_since_ms: now - 60_000, branches_unread: 0 };
const old = { agent: "claude", session: "claude:0b0b-synthetic", terminal: "t2", host: "herdr" }; // an older CLI

assert.equal(knowsUnread(api), true);
assert.equal(knowsUnread(web), true);
assert.equal(knowsUnread(old), false);

assert.equal(unreadBadge(api), "3 unread");
assert.equal(unreadBadge({ unread: true, unread_turns: 0 }), "1 unread"); // unread says so
assert.equal(unreadBadge(web), null);
assert.equal(unreadBadge(old), null);
assert.equal(branchBadge(api), "⑂ 2");
assert.equal(branchTip(api), "2 branches with unread replies");
assert.equal(branchTip({ branches_unread: 1 }), "1 branch with unread replies");
assert.equal(branchBadge(web), null);
assert.equal(branchBadge(old), null);

// Agents, not turns; a row with no agent (a terminal that lost it) doesn't count.
assert.equal(unreadCount([api, web, vscode, old, { agent: null, unread: true }]), 2);
assert.equal(unreadCount([old]), 0);
assert.equal(unreadCount(null), 0);

// The Herdr terminal, else the session as AGENT:ID.
assert.equal(sessionArg(api), "t12");
assert.equal(sessionArg(vscode), "claude:9c0f-synthetic");
assert.equal(sessionArg({ agent: "pi", terminal: null, session: null }), null);
assert.deepEqual(seenArgs("t12"), ["seen", "t12"]);
assert.deepEqual(seenArgs("t12", true), ["seen", "t12", "--unread"]);
assert.equal(seenArgs(null), null);

// Focusing from the mod marks seen, read or not, but never on a CLI without `unread`.
assert.deepEqual(seenOnFocus(api), ["seen", "t12"]);
assert.deepEqual(seenOnFocus(web), ["seen", "t4"]);
assert.equal(seenOnFocus(old), null);
assert.deepEqual(markUnreadArgs(web), ["seen", "t4", "--unread"]);
assert.equal(markUnreadArgs(api), null); // already unread
assert.equal(markUnreadArgs(old), null);
assert.equal(markUnreadArgs({ ...web, turn_ended_ms: null }), null); // mid-turn: nothing to mark
assert.equal(markUnreadArgs({ agent: null, unread: false, terminal: "t9" }), null);

// The recap once the oldest unread turn ended 10+ minutes ago.
assert.equal(wantsRecap(api, now), true);
assert.equal(wantsRecap({ ...api, unread_since_ms: now - RECAP_AFTER_MS + 1000 }, now), false);
assert.equal(wantsRecap({ ...api, unread_since_ms: null }, now), false);
assert.equal(wantsRecap(web, now), false);
assert.equal(wantsRecap(old, now), false);
assert.equal(recapKey(api), "claude:5d1e-synthetic#3");
assert.equal(recapKey({ ...api, unread_turns: 4 }), "claude:5d1e-synthetic#4"); // another turn: fetched again
assert.equal(recapKey(vscode), "claude:9c0f-synthetic#1");
assert.deepEqual(recapArgs(api), ["recap", "t12"]);
assert.deepEqual(recapArgs(vscode), ["recap", "claude:9c0f-synthetic"]);

// `trailboss --json recap t12`, made up, to the contract.
const recap = [
  {
    session: "claude:5d1e-synthetic", agent: "claude", title: "Add rate limits", host: "herdr", terminal: "t12",
    since_ms: now - 42 * 60_000, until_ms: now, away_ms: 42 * 60_000, turns: 3, files: 6, commands: 11,
    checks: [{ command: "cargo test", passed: true }],
    state: "done", said: "Rate limits are in; all tests pass.", model: "claude-opus-5-5", context_pct: 41, cost_usd: 0.42,
    line: "api while you were away (42m): 3 turns, 6 files, 11 commands, cargo test passed, at prompt",
  },
];
assert.equal(readRecap(recap, api).line, recap[0].line);
assert.equal(readRecap([{ ...recap[0], session: "claude:other" }], api).session, "claude:other"); // the only one
assert.equal(readRecap([{ ...recap[0], session: "claude:x" }, { ...recap[0], session: "claude:y" }], api), null);
assert.equal(readRecap([{ ...recap[0], line: "" }], api), null);
assert.equal(readRecap([], api), null);
assert.equal(readRecap(null, api), null);
assert.equal(recapTip(recap[0]), "Rate limits are in; all tests pass.\nOpus 5.5 · 41% context · $0.42");
assert.equal(recapTip({ line: "x", said: null, model: null, context_pct: null, cost_usd: null }), "");
assert.equal(recapTip(null), "");

// A notification's click focuses with Herdr's own action: the next look marks it seen when
// that terminal is in front and unread.
const notified = { t12: now - 60_000, t4: now - 60_000, t2: now - NOTIFIED_FOR_MS - 1 };
let r = seenAfterNotice(notified, "t12", [api, web], now);
assert.deepEqual(r.seen, ["seen", "t12"]);
assert.deepEqual(r.notified, { t4: now - 60_000 }); // t12 done, t2 expired
r = seenAfterNotice(notified, "t4", [api, web], now); // in front, but read already
assert.equal(r.seen, null);
assert.deepEqual(Object.keys(r.notified), ["t12", "t4"]);
assert.equal(seenAfterNotice({}, "t12", [api], now).seen, null); // no notification for it
assert.equal(seenAfterNotice(notified, null, [api], now).seen, null);
assert.equal(seenAfterNotice({ t2: now }, "t2", [old], now).seen, null); // an older CLI
assert.deepEqual(seenAfterNotice(null, "t12", [api], now), { seen: null, notified: {} });

console.log("unread.test.mjs: ok");
