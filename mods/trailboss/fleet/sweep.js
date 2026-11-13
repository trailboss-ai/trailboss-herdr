// What Live's Sweep panel shows from `trailboss sweep`: the agents and tasks started from a
// session, grouped by what comes next (your decisions, then waits, then the rest). Pure, so
// sweep.test.mjs runs it under node.

// A Live row's session as `sweep --parent` takes it (AGENT:ID); null when it has none.
export function sweepParent(r) {
  if (!r?.session) return null;
  return r.session.includes(":") || !r.agent ? r.session : `${r.agent}:${r.session}`;
}

// The order of `next`'s kinds; a kind this mod doesn't know goes after these, as is.
const KINDS = ["decision", "wait", "info"];
const HEADINGS = { decision: "Your decision", wait: "Waiting", info: "At rest", none: "Nothing next" };
export const heading = (kind) => HEADINGS[kind] ?? (kind ? kind[0].toUpperCase() + kind.slice(1) : HEADINGS.none);

// The `next` step for a row (at most one per row): by task number, else session, else name.
export function nextFor(row, next) {
  const i = (next ?? []).findIndex((s) =>
    row.n != null ? s.n === row.n : row.session ? s.session === row.session : s.n == null && !s.session && s.name === row.name,
  );
  return i < 0 ? null : { ...next[i], i };
}

// The rows in groups by their next step's kind: [{ kind, rows: [{ row, next }] }], decisions
// first, then waits, info, kinds added later, and rows with no next step ("none") last. Within
// a group, `next`'s own order, else sweep's (breadth first).
export function sweepGroups(data) {
  const groups = new Map();
  for (const row of data?.rows ?? []) {
    const next = nextFor(row, data.next);
    const kind = next?.kind ?? "none";
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({ row, next });
  }
  const rank = (k) => (k === "none" ? KINDS.length + 1 : KINDS.includes(k) ? KINDS.indexOf(k) : KINDS.length);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([kind, rows]) => ({ kind, rows: rows.sort((a, b) => (a.next?.i ?? Infinity) - (b.next?.i ?? Infinity)) }));
}

// "2 decisions · 1 waiting": what the groups add up to; "" when nothing is next.
export function sweepCounts(groups) {
  const n = (k) => groups.find((g) => g.kind === k)?.rows.length ?? 0;
  const out = [];
  if (n("decision")) out.push(`${n("decision")} ${n("decision") === 1 ? "decision" : "decisions"}`);
  if (n("wait")) out.push(`${n("wait")} waiting`);
  return out.join(" · ");
}

// The theme color (a key of Herdr's theme) for a row's state; one this mod doesn't know is muted.
export function stateTone(state) {
  if (state === "needs you") return "blocked";
  if (state === "working") return "working";
  if (state === "ready" || state === "done") return "done";
  if (state === "ended" || state === "missing") return "dim";
  if (state === "to do") return "idle";
  return "muted";
}

// And for a next step's kind.
export const nextTone = (kind) => (kind === "decision" ? "blocked" : kind === "wait" ? "working" : "dim");

const CI = { passing: "CI ✓", failing: "CI ✗", pending: "CI …", none: "" };

// A task's PR as a badge: { text: "#41 · CI ✓", tone, url }, the tone the most pressing
// thing about it; null when it has no PR.
export function prBadge(pr) {
  if (!pr) return null;
  const parts = [`#${pr.number}`];
  if (pr.state && pr.state !== "open") parts.push(pr.state);
  else if (pr.draft) parts.push("draft");
  const ci = CI[pr.ci] ?? pr.ci ?? "";
  if (ci) parts.push(ci);
  if (pr.conflicts) parts.push("conflicts");
  if (pr.unresolved_threads) parts.push(`${pr.unresolved_threads} ${pr.unresolved_threads === 1 ? "thread" : "threads"}`);
  let tone = "muted";
  if (pr.state === "merged") tone = "done";
  else if (pr.state === "open") {
    if (pr.ci === "failing" || pr.conflicts || pr.unresolved_threads) tone = "blocked";
    else if (pr.ci === "pending") tone = "working";
    else if (pr.ci === "passing") tone = "done";
  }
  return { text: parts.join(" · "), tone, url: pr.url ?? null };
}

// The first non-empty line of what the agent last said; "" when nothing.
export const firstLine = (s) => (s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";

// The Herdr terminal to focus for a sweep row: its session's terminal in Live, when Herdr runs it.
export function terminalFor(row, live) {
  if (!row?.session) return null;
  const r = (live ?? []).find((x) => sweepParent(x) === row.session);
  return r?.terminal && (r.host ?? "herdr") === "herdr" ? r.terminal : null;
}
