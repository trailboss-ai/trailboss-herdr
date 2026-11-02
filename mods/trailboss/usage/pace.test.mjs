// node integrations/herdr/mods/trailboss/usage/pace.test.mjs
import assert from "node:assert/strict";
import { toWarn, warning } from "./pace.js";

const row = (pace, resets_at = 2000, window = "5h") => ({
  provider: "claude", window, used: "62%", pace_percent: pace, resets_at, resets_in: "2h 10m", limit_in: "40m",
});

// Over pace: warned once; on pace or no reset time: never.
let r = toWarn([row(130), row(90, 2000, "7d"), { ...row(150), resets_at: null }], {}, 1000);
assert.equal(r.warn.length, 1);
assert.deepEqual(r.warned, { "claude:5h:2000": 2000 });
assert.equal(toWarn([row(140)], r.warned, 1100).warn.length, 0, "same window: no repeat");

// The window resets: the old note is dropped, and the new window can warn again.
r = toWarn([row(120, 20000)], r.warned, 2500);
assert.equal(r.warn.length, 1);
assert.deepEqual(r.warned, { "claude:5h:20000": 20000 });

assert.deepEqual(warning(row(130)), {
  title: "Claude 5h limit in ~40m at this pace",
  body: "62% used, on pace for 130%; resets in 2h 10m",
});
console.log("pace.test.mjs: ok");
