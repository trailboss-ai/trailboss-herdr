// The Live tab's send bar and queued messages: who a row can be sent to, the `send` and
// `queue` arguments, and how their results read. Pure, so send.test.mjs runs it under node.

// `send --to` for a `live` row: herdr:t3, tmux:work:2.1; null when it has no terminal to type into.
export function target(row) {
  if (!row?.agent || !row.terminal) return null;
  return `${row.host ?? "herdr"}:${row.terminal}`;
}

/** `trailboss send` arguments: type `message` into `targets` now, or with `queue`, keep it
 * for any agent mid-turn and type it once that turn ends. */
export function sendArgs(message, targets, queue = false) {
  return ["send", "--yes", ...(queue ? ["--queue"] : []), ...targets.flatMap((t) => ["--to", t]), "--", message];
}

// How each `send` action and `queue` state reads: [label, tone]; tone is a theme color name.
// An action this mod doesn't know shows as is.
const ACTIONS = {
  sent: ["sent", "done"],
  held: ["held", "working"],
  "no reaction": ["no reaction", "blocked"],
  skipped: ["skipped", "dim"],
  queued: ["queued", "working"],
  "would send": ["would send", "muted"],
  "would queue": ["would queue", "muted"],
  waiting: ["queued", "working"],
  due: ["due", "working"],
  typing: ["typing…", "working"],
  unknown: ["unknown", "dim"],
};
export function tone(action) {
  return ACTIONS[action] ?? [action ?? "", "muted"];
}

// What's shown on a row while `send --yes` is out: it checks each agent before answering.
export const CHECKING = ["checking…", "dim"];

/** `send` rows by `where`, for the rows Live shows; `rest` are the ones no Live row matches
 * (a selector that found no agent, an agent that has since gone). */
export function byWhere(results, liveRows) {
  const shown = new Set((liveRows ?? []).map((r) => r.where));
  const map = {};
  const rest = [];
  for (const r of results ?? []) {
    if (shown.has(r.where)) map[r.where] = r;
    else rest.push(r);
  }
  return { map, rest };
}

// Whether a `queue` message is still waiting to be typed (finished ones have at_ms).
export const pending = (q) => q.at_ms == null;

/** The pending queued messages for a `live` row, oldest first: the same session when both
 * know it (a message is only typed into the session it was queued for), else the same place. */
export function queuedFor(queue, row) {
  return (queue ?? []).filter(
    (q) => pending(q) && (q.session && row.session ? q.session === row.session : q.where === row.where),
  );
}

/** Pending messages no Live row shows (their agent has gone, or its session changed). */
export function queuedElsewhere(queue, liveRows) {
  return (queue ?? []).filter((q) => pending(q) && !(liveRows ?? []).some((r) => queuedFor([q], r).length));
}

// One line for a queued message: "q4 · rebase on main when you're done · waits for its turn to end".
export function queuedText(q, max = 60) {
  const m = q.message ?? "";
  const msg = m.length > max ? `${m.slice(0, max - 1)}…` : m;
  return [q.id, msg && `“${msg}”`, q.detail].filter(Boolean).join(" · ");
}

/** Whether nothing delivers the queue: a pending message or a `queued` send row says
 * nothing_looking (no `events`, `watch` or Herdr block has looked in the last 5 minutes). */
export function nothingLooking(queue, results) {
  return [...(queue ?? []).filter(pending), ...(results ?? []).filter((r) => r.action === "queued")].some(
    (r) => r.nothing_looking,
  );
}

export const NOTHING_LOOKING =
  "Nothing is delivering queued messages: they wait until Trailboss's status-bar block (it delivers while it runs), trailboss watch or trailboss events looks at the agents.";

// A summary for after `send`: "2 sent · 1 held · 1 skipped".
export function summary(results) {
  const n = {};
  for (const r of results ?? []) n[r.action] = (n[r.action] ?? 0) + 1;
  return Object.entries(n)
    .map(([a, c]) => `${c} ${a}`)
    .join(" · ");
}

// What `queue rm` did with one id, for a notification: { title, level }.
export function removedText(rows, id) {
  const r = (rows ?? []).find((x) => x.id === id);
  if (r?.action === "removed") return { title: `Took back ${id}`, level: "success" };
  if (r?.action === "typing") return { title: `${id} is being typed now: too late to take it back`, level: "info" };
  if (r?.action === "not found") return { title: `${id} is no longer queued`, level: "info" };
  return { title: `${id}: ${r?.action ?? "no answer"}`, level: "info" };
}
