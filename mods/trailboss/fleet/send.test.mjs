// node mods/trailboss/fleet/send.test.mjs
import assert from "node:assert/strict";
import {
  target,
  sendArgs,
  tone,
  byWhere,
  queuedFor,
  queuedElsewhere,
  queuedText,
  nothingLooking,
  summary,
  removedText,
} from "./send.js";

assert.equal(target({ agent: "claude", host: "herdr", terminal: "t3" }), "herdr:t3");
assert.equal(target({ agent: "claude", terminal: "t3" }), "herdr:t3");
assert.equal(target({ agent: "claude", host: "tmux", terminal: "work:2.1" }), "tmux:work:2.1");
assert.equal(target({ agent: "pi", host: null, terminal: null }), null); // no terminal to type into
assert.equal(target({ agent: null, terminal: "t9" }), null);

assert.deepEqual(sendArgs("hi", ["herdr:t3", "herdr:t5"]), ["send", "--yes", "--to", "herdr:t3", "--to", "herdr:t5", "--", "hi"]);
// A message starting with a dash isn't read as an option.
assert.deepEqual(sendArgs("-v please", ["herdr:t3"], true), ["send", "--yes", "--queue", "--to", "herdr:t3", "--", "-v please"]);

assert.deepEqual(tone("sent"), ["sent", "done"]);
assert.deepEqual(tone("held"), ["held", "working"]);
assert.deepEqual(tone("no reaction"), ["no reaction", "blocked"]);
assert.deepEqual(tone("waiting"), ["queued", "working"]);
assert.deepEqual(tone("bounced"), ["bounced", "muted"]); // unknown actions show as is

const live = [
  { where: "t2 shop", session: "0c6f2a5e-synthetic" },
  { where: "t3 api", session: "5d1e-synthetic" },
  { where: "t8 web", session: "other-session" },
];
const sent = [
  { where: "t3 api", agent: "claude", action: "sent", detail: "was idle; started a turn" },
  { where: "t2 shop", agent: "claude", action: "queued", detail: "it's working; typed after its turn ends (q4)", id: "q4", nothing_looking: false },
  { where: "t9", agent: null, action: "skipped", detail: "no agent there" },
];
const { map, rest } = byWhere(sent, live);
assert.deepEqual(Object.keys(map).sort(), ["t2 shop", "t3 api"]);
assert.deepEqual(rest.map((r) => r.where), ["t9"]);
assert.equal(summary(sent), "1 sent · 1 queued · 1 skipped");

const queue = [
  { id: "q4", where: "t2 shop", session: "0c6f2a5e-synthetic", state: "waiting", detail: "waits for its turn to end", message: "rebase on main when you're done", at_ms: null, nothing_looking: false },
  { id: "q5", where: "t8 web", session: "019a-synthetic", state: "due", detail: "its turn ended", message: "run the e2e tests too", at_ms: null, nothing_looking: false },
  { id: "q3", where: "t3 api", session: "5d1e-synthetic", state: "sent", detail: "was idle; started a turn", message: null, at_ms: 1792999400000, nothing_looking: false },
];
assert.deepEqual(queuedFor(queue, live[0]).map((q) => q.id), ["q4"]);
assert.deepEqual(queuedFor(queue, live[1]), []); // q3 is finished
// q5 was queued for a session t8 no longer runs: it's never typed there.
assert.deepEqual(queuedFor(queue, live[2]), []);
assert.deepEqual(queuedElsewhere(queue, live).map((q) => q.id), ["q5"]);
// Without sessions on either side, the place decides.
assert.deepEqual(queuedFor([{ ...queue[0], session: null }], { where: "t2 shop", session: null }).map((q) => q.id), ["q4"]);

assert.equal(queuedText(queue[0]), "q4 · “rebase on main when you're done” · waits for its turn to end");
assert.equal(queuedText({ ...queue[0], message: "x".repeat(80) }, 10), `q4 · “${"x".repeat(9)}…” · waits for its turn to end`);

assert.equal(nothingLooking(queue, sent), false);
assert.equal(nothingLooking([{ ...queue[0], nothing_looking: true }], []), true);
assert.equal(nothingLooking([], [{ ...sent[1], nothing_looking: true }]), true);
// A finished message never says so.
assert.equal(nothingLooking([{ ...queue[2], nothing_looking: true }], []), false);

assert.deepEqual(removedText([{ id: "q4", where: "t2 shop", action: "removed" }], "q4"), { title: "Took back q4", level: "success" });
assert.equal(removedText([{ id: "q4", where: "t2 shop", action: "typing" }], "q4").level, "info");
assert.equal(removedText([{ id: "q9", where: null, action: "not found" }], "q9").title, "q9 is no longer queued");

console.log("send: ok");
