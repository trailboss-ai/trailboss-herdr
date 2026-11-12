// node mods/trailboss/fleet/live.test.mjs
import assert from "node:assert/strict";
import { rank, needsWords, needsByTerminal, detailsOn, ago, statusFor, modelName, effortName, contextText, modelParts, turnText, resources } from "./live.js";

assert.deepEqual(
  ["blocked", "done", "working", "busy", "idle", "lost", undefined].map((status) => rank({ status })),
  [0, 1, 2, 2, 3, 4, 4],
);
// A turn that ended on a question needs you too.
assert.equal(rank({ status: "idle", needs: "Should I push?", needs_kind: "reply" }), 0);

// Only the kind, unless details are on; an unknown kind still says it waits.
const run = { needs: "Run: cargo test -p client", needs_kind: "run" };
assert.equal(needsWords(run), "Run a command");
assert.equal(needsWords(run, true), "Run: cargo test -p client");
assert.equal(needsWords({ needs: "x", needs_kind: "new_kind" }), "Waiting for you");
assert.equal(needsWords({ needs: null, needs_kind: null }), null);
assert.equal(detailsOn({ notifications: { details: true } }), true);
assert.equal(detailsOn({ notifications: { details: "yes" } }), false);
assert.equal(detailsOn(null), false);

// Only Herdr's own terminals, only those that need you.
const fleet = [
  { terminal: "t5", host: "herdr", agent: "codex", needs: "Run: cargo test", needs_kind: "run" },
  { terminal: "t3", host: "herdr", agent: "claude", needs: null },
  { terminal: "w1", host: "vscode", agent: "claude", needs: "Plan", needs_kind: "plan" },
  { terminal: null, agent: "pi", needs: "Send it?", needs_kind: "reply" },
];
assert.deepEqual(needsByTerminal(fleet), { t5: [{ agent: "codex", why: "Run a command" }] });
assert.deepEqual(needsByTerminal(fleet, true), { t5: [{ agent: "codex", why: "Run: cargo test" }] });

const now = 1_790_850_000_000;
assert.equal(ago(now - 45_000, now), "45s");
assert.equal(ago(now - 12 * 60_000, now), "12m");
assert.equal(ago(now - 3 * 3_600_000, now), "3h");
assert.equal(ago(now - 50 * 3_600_000, now), "2d");
assert.equal(ago(null, now), "");
assert.equal(ago(now + 5000, now), "");
assert.equal(statusFor({ status: "blocked", status_since: now - 12 * 60_000 }, now), "blocked 12m");
assert.equal(statusFor({ status: "working", status_since: null }, now), "working");

assert.equal(modelName("claude-opus-5-5"), "Opus 5.5");
assert.equal(modelName("claude-sonnet-4-6"), "Sonnet 4.6");
assert.equal(modelName("claude-opus-4-1-20250805"), "Opus 4.1");
assert.equal(modelName("claude-3-5-sonnet-20241022"), "Sonnet 3.5");
assert.equal(modelName("claude-sonnet-4-5[1m]"), "Sonnet 4.5");
assert.equal(modelName("claude-haiku-5-5"), "Haiku 5.5");
assert.equal(modelName("us.anthropic.claude-opus-4-1-20250805-v1:0"), "Opus 4.1");
assert.equal(modelName("gpt-5-codex"), "GPT-5 Codex");
assert.equal(modelName("gpt-5.1-codex-max"), "GPT-5.1 Codex Max");
assert.equal(modelName("gemini-2.5-pro"), "Gemini 2.5 Pro");
assert.equal(modelName("qwen3-coder"), "qwen3-coder");
assert.equal(modelName(null), null);
assert.equal(effortName("high"), "High");
assert.equal(effortName("xhigh"), "XHigh");
assert.equal(effortName(null), null);

assert.equal(contextText({ context_pct: 38 }), "38% context");
assert.equal(contextText({ context_pct: null, context_tokens: 380112 }), "380K context");
assert.equal(contextText({}), null);
assert.deepEqual(modelParts({ model: "claude-opus-5-5", effort: "high", context_pct: 38 }), ["Opus 5.5", "High", "38% context"]);
assert.deepEqual(modelParts({ model: null, effort: null }), []);

assert.equal(turnText({ turn: 7, turn_ended_ms: null }, now), "turn 7");
assert.equal(turnText({ turn: 4, turn_ended_ms: now - 180_000 }, now), "turn 4 ended 3m ago");
assert.equal(turnText({ turn: null }, now), "");

assert.equal(resources({ cpu_pct: 38.2, rss_bytes: 612368384 }), "38% cpu · 584 MB");
assert.equal(resources({ cpu_pct: 0.4, rss_bytes: 3 * 2 ** 30 }), "0% cpu · 3.0 GB");
assert.equal(resources({ cpu_pct: null, rss_bytes: null }), "");

console.log("live.test.mjs: ok");
