// node mods/trailboss/fleet/live.test.mjs
import assert from "node:assert/strict";
import { rank, needsWords, needsByTerminal, detailsOn, ago, statusFor, modelName, effortName, contextText, modelParts, turnText, resources, loadParts, backgroundText, backgroundTip, quietText, pinArgs, unpinArgs, rowToggles, markers, alertText, alertTip, spendNotice } from "./live.js";

assert.deepEqual(
  ["blocked", "done", "working", "busy", "idle", "lost", undefined].map((status) => rank({ status })),
  [0, 1, 2, 2, 3, 4, 4],
);
// A turn that ended on a question needs you too.
assert.equal(rank({ status: "idle", needs: "Should I push?", needs_kind: "reply" }), 0);
assert.equal(rank({ status: "working", stuck: true }), 0);

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
// Never the reason itself: shared state is saved to disk.
assert.deepEqual(needsByTerminal(fleet, true), { t5: [{ agent: "codex", why: "Run a command" }] });

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

// Dim unless high: a core kept busy, or 2 GB.
assert.deepEqual(loadParts({ cpu_pct: 38.2, rss_bytes: 612368384 }), [["38% cpu", false], ["584 MB", false]]);
assert.deepEqual(loadParts({ cpu_pct: 140, rss_bytes: 2 * 2 ** 30 }), [["140% cpu", true], ["2.0 GB", true]]);
assert.deepEqual(loadParts({ cpu_pct: 99.9, rss_bytes: null }), [["100% cpu", false]]);
assert.deepEqual(loadParts({}), []);

const shells = [
  { kind: "shell", label: "npm run dev", since: now - 12 * 60_000 },
  { kind: "shell", label: "cargo watch -x test", since: null },
];
assert.equal(backgroundText({ background: shells }), "2 background shells");
assert.equal(backgroundText({ background: [shells[0]] }), "1 background shell");
assert.equal(backgroundText({ background: [{ kind: "process", label: "vite", since: null }] }), "1 background process");
assert.equal(backgroundText({ background: [...shells, { kind: "monitor", label: "tail log", since: null }] }), "3 background jobs");
assert.equal(backgroundText({ background: [{ kind: "new_kind", label: "x", since: null }] }), "1 background job");
assert.equal(backgroundText({ background: [] }), null);
assert.equal(backgroundText({ background: null }), null);
assert.equal(backgroundTip({ background: shells }, now), "shell · npm run dev · 12m\nshell · cargo watch -x test");
assert.equal(backgroundTip({ background: null }, now), "");

assert.deepEqual(quietText({ stuck: true, quiet_min: 12 }), ["stuck 12m", "blocked"]);
assert.deepEqual(quietText({ stuck: false, quiet_busy: true, quiet_min: 15 }), ["busy 15m", "working"]);
assert.deepEqual(quietText({ quiet_busy: true, quiet_min: null }), ["busy", "working"]);
assert.equal(quietText({ stuck: false, quiet_busy: false }), null);

assert.deepEqual(pinArgs({ agent: "claude", terminal: "t3", session: "5d1e-synthetic" }), ["live", "--pin", "t3"]);
assert.deepEqual(pinArgs({ agent: "claude", terminal: null, session: "5d1e-synthetic" }), ["live", "--pin", "5d1e-synthetic"]);
assert.equal(pinArgs({ agent: null, terminal: "t9", session: null }), null); // no agent to pin
assert.equal(pinArgs({ agent: "pi", terminal: null, session: null }), null);
// One call, whichever it was pinned by: the CLI takes the terminal or the session.
assert.deepEqual(unpinArgs({ agent: "claude", terminal: "t3", session: "5d1e-synthetic" }), ["live", "--unpin", "t3"]);
assert.deepEqual(unpinArgs({ agent: "claude", terminal: null, session: "5d1e-synthetic" }), ["live", "--unpin", "5d1e-synthetic"]);
assert.equal(unpinArgs({ agent: null, terminal: "t9", session: null }), null);

// Quiet and Settle only when the CLI says whether a row is: an older one has neither field.
const labels = (r) => rowToggles(r).map(([label]) => label);
const row = { agent: "claude", terminal: "t3", session: "5d1e-synthetic", pinned: false };
assert.deepEqual(labels(row), ["Pin"]);
assert.deepEqual(labels({ ...row, quiet: false, settled: false }), ["Quiet", "Settle", "Pin"]);
assert.deepEqual(labels({ ...row, quiet: true, settled: true, pinned: true }), ["Unquiet", "Unsettle", "Unpin"]);
const calls = (r) => Object.fromEntries(rowToggles(r).map(([label, c]) => [label, c]));
assert.deepEqual(calls({ ...row, quiet: false, settled: false }).Settle, [["live", "--settle", "t3"]]);
assert.deepEqual(calls({ ...row, quiet: true, settled: false }).Unquiet, [["live", "--unquiet", "t3"]]);
// No terminal: the session, as for --pin.
assert.deepEqual(calls({ ...row, terminal: null, settled: true }).Unsettle, [["live", "--unsettle", "5d1e-synthetic"]]);
assert.deepEqual(calls({ ...row, quiet: false }).Quiet, [["live", "--quiet", "t3"]]);
assert.deepEqual(calls({ ...row, pinned: true }).Unpin, [["live", "--unpin", "t3"]]);
assert.deepEqual(calls({ ...row, terminal: null, pinned: true }).Unpin, [["live", "--unpin", "5d1e-synthetic"]]);
assert.deepEqual(rowToggles({ agent: null, terminal: "t8", quiet: false, settled: false }), []);
assert.equal(markers({ pinned: true, quiet: true, settled: false }), "pinned · quiet · ");
assert.equal(markers({}), "");

// Spending alerts, short.
assert.equal(alertText({ limit: "session", amount_usd: 12.35, limit_usd: 10 }), "$12.35 > $10 session");
assert.equal(alertText({ limit: "folder", amount_usd: 31.2, limit_usd: 30.5 }), "$31.20 > $30.50 folder");
assert.equal(alertText({ limit: "session", amount_usd: 4.12, limit_usd: 4.0 }), "$4.12 > $4 session");
assert.equal(alertText(undefined), null);
assert.equal(alertText({ limit: "session", amount_usd: null, limit_usd: 4 }), null);
assert.match(alertTip({ limit: "session", amount_usd: 5, limit_usd: 4 }), /alerts\.session_usd/);
assert.match(alertTip({ limit: "new_limit", amount_usd: 5, limit_usd: 4 }), /new_limit/);
assert.equal(alertTip(undefined), "");

// spend_alert events, as the spec's examples give them.
const ev = {
  kind: "spend_alert",
  where: "t3 api",
  terminal: "t3",
  agent: "claude",
  title: "Add retry to the billing client",
  cwd: "/home/user/code/api",
  alert: { limit: "session", amount_usd: 4.12, limit_usd: 4.0 },
};
assert.deepEqual(spendNotice(ev), { title: "Spending alert: $4.12 > $4 session", body: "claude t3 api · Add retry to the billing client" });
assert.deepEqual(spendNotice({ ...ev, where: null, terminal: null, agent: null, title: null, alert: { limit: "folder", amount_usd: 31.2, limit_usd: 30 } }), {
  title: "Spending alert: $31.20 > $30 folder",
  body: "/home/user/code/api",
});
assert.deepEqual(spendNotice({ kind: "spend_alert", where: null, agent: null, cwd: null, alert: { limit: "day", amount_usd: 51.37, limit_usd: 50 } }), {
  title: "Spending alert: $51.37 > $50 day",
  body: "All agents today",
});
assert.equal(spendNotice({ kind: "spend_alert" }), null);

console.log("live.test.mjs: ok");
