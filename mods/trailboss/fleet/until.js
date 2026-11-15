// A running `trailboss until` loop on its session's Live row, from `trailboss until ls`:
// "until: round 2 · failing · $0.84", the check and how long it has run on hover, and Pause,
// Resume and Stop. A CLI without `until ls` (or one that fails) shows nothing. Pure, so
// until.test.mjs runs it under node.

import { sweepParent } from "./sweep.js";
import { ago } from "./live.js";

// `until ls` asks once per Live refresh, for every row.
export const LS_ARGS = ["until", "ls"];

// Only well-formed loops, so a draw never trips on one.
export const readLoops = (rows) => (Array.isArray(rows) ? rows.filter((l) => l && Number.isInteger(l.id) && l.agent) : []);

// Where a Live row runs, as `until ls` names it: "herdr:t3".
const whereOf = (r) => (r?.terminal ? `${r.host ?? "herdr"}:${r.terminal}` : null);

// Each Live row's loop, a Map from row to loop: the loop on its agent and session, else the
// one in its terminal. A loop goes to one row at most.
export function loopsByRow(live, loops) {
  const out = new Map();
  const rows = (live ?? []).filter((r) => r?.agent);
  const left = readLoops(loops);
  if (!rows.length || !left.length) return out;
  const take = (r, find) => {
    const i = left.findIndex(find);
    if (i >= 0) out.set(r, left.splice(i, 1)[0]);
  };
  for (const r of rows) {
    const s = sweepParent(r);
    if (s) take(r, (l) => l.session && `${l.agent}:${l.session}` === s);
  }
  for (const r of rows) {
    const w = whereOf(r);
    if (!out.has(r) && w) take(r, (l) => l.terminal === w);
  }
  return out;
}

// The loop's state in a word, and its tone (a theme color name): a stop or pause asked and
// not yet taken up first, then paused or waiting, else how its last check went.
export function untilState(l) {
  if (l.requested === "stop" || l.state === "stopped") return ["stopping", "dim"];
  if (l.requested === "pause") return ["pausing", "dim"];
  if (l.state === "paused") return ["paused", "dim"];
  if (l.state === "waiting") return ["waiting", "dim"];
  if (l.state === "checking") return ["checking", "working"];
  if (l.last_passed === true) return ["passing", "done"];
  if (l.last_passed === false) return ["failing", "blocked"];
  return ["running", "working"];
}

const dollars = (x) => (typeof x === "number" ? `$${x.toFixed(2)}` : null);

// "until: round 2 · failing · $0.84"; [text, tone].
export function untilChip(l) {
  const [word, tone] = untilState(l);
  return [["until: round " + (l.round ?? 0), word, dollars(l.cost_usd)].filter(Boolean).join(" · "), tone];
}

// The chip's tooltip: the check, where it runs, how long it has run and, while waiting, when
// it goes on.
export function untilTip(l, now = Date.now()) {
  const run = l.minutes != null ? `${l.minutes} min running` : null;
  // ago() of now as of the reset: how long is left.
  const resumes = l.state === "waiting" && l.paused_until != null && l.paused_until * 1000 > now ? `waits ${ago(now, l.paused_until * 1000) || "a moment"} more` : null;
  return [`until ${l.check}`, l.cwd, [run, resumes].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
}

// The row actions a loop offers now: [label, args, tooltip]. Pause while it runs, Resume once
// paused, Stop until a stop is asked.
export function untilActions(l) {
  const id = String(l.id);
  const out = [];
  const live = ["running", "checking", "waiting"].includes(l.state);
  if (live && !l.requested) out.push(["Pause", ["until", "pause", id], "Pause the loop (trailboss until pause)"]);
  if (l.state === "paused" && l.requested !== "stop") out.push(["Resume", ["until", "resume", id], "Go on with the loop (trailboss until resume)"]);
  if (l.state !== "stopped" && l.requested !== "stop") out.push(["Stop", ["until", "stop", id], "End the loop (trailboss until stop)"]);
  return out;
}
