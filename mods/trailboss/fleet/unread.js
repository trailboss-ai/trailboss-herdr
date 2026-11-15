// Unread replies: a finished turn you haven't seen, from `trailboss live`'s `unread` fields,
// `trailboss seen` to mark a session seen (or unread again) and `trailboss recap`, what it
// did while you were away. A CLI without them shows no badge and no recap, and nothing runs
// `seen`. Pure, so unread.test.mjs runs it under node.

import { sweepParent } from "./sweep.js";
import { modelName } from "./live.js";

// Whether the CLI says if this row is unread: older ones have no `unread` field.
export const knowsUnread = (r) => typeof r?.unread === "boolean";

// "3 unread" for a row with unread finished turns; null otherwise.
export function unreadBadge(r) {
  if (r?.unread !== true) return null;
  return `${r.unread_turns > 0 ? r.unread_turns : 1} unread`;
}

// "⑂ 2" when sessions started from this one have unread replies; null otherwise.
export const branchBadge = (r) => (r?.branches_unread > 0 ? `⑂ ${r.branches_unread}` : null);
export const branchTip = (r) => `${r.branches_unread} ${r.branches_unread === 1 ? "branch" : "branches"} with unread replies`;

// How many agents have unread replies, for the status-bar block.
export const unreadCount = (live) => (live ?? []).filter((r) => r?.agent && r.unread === true).length;

// What `seen` and `recap` take for a row: its Herdr terminal, else its session (AGENT:ID).
export function sessionArg(r) {
  if (r?.terminal && (r.host ?? "herdr") === "herdr") return r.terminal;
  return sweepParent(r);
}

// `trailboss seen` for a terminal or session; with `unread`, marks it unread again.
export const seenArgs = (what, unread = false) => (what ? ["seen", what, ...(unread ? ["--unread"] : [])] : null);

// After the mod focuses a row's terminal: mark it seen, only when the CLI tracks unread.
export const seenOnFocus = (r) => (knowsUnread(r) ? seenArgs(sessionArg(r)) : null);

// The row action that marks a seen row unread again, once a turn of it has ended; null when
// the CLI doesn't track it, it's unread already, or no turn has finished.
export const markUnreadArgs = (r) => (r?.agent && r.unread === false && r.turn_ended_ms != null ? seenArgs(sessionArg(r), true) : null);

// A row's away recap: once its oldest unread turn ended this long ago.
export const RECAP_AFTER_MS = 10 * 60_000;
export const wantsRecap = (r, now = Date.now()) =>
  r?.unread === true && r.unread_since_ms != null && now - r.unread_since_ms >= RECAP_AFTER_MS && Boolean(sessionArg(r));

// The recap's cache key: a new one each time the unread turns change.
export const recapKey = (r) => `${sweepParent(r) ?? r?.terminal}#${r?.unread_turns ?? 0}`;
export const recapArgs = (r) => ["recap", sessionArg(r)];

// The recap for a row from `recap <terminal>`'s rows: the one for its session, else the only
// one; null when there's none or it has no line.
export function readRecap(rows, r) {
  if (!Array.isArray(rows)) return null;
  const s = sweepParent(r);
  const rc = rows.find((x) => x?.session && x.session === s) ?? (rows.length === 1 ? rows[0] : null);
  return rc?.line ? rc : null;
}

// The recap's tooltip: the last thing it said, then model, context and cost.
export function recapTip(rc) {
  if (!rc) return "";
  const runs = [
    modelName(rc.model),
    rc.context_pct != null ? `${rc.context_pct}% context` : null,
    rc.cost_usd != null ? `$${rc.cost_usd.toFixed(2)}` : null,
  ].filter(Boolean);
  return [rc.said, runs.join(" · ")].filter(Boolean).join("\n");
}

// Notifications the block posted for a Herdr terminal, { terminal: ms }: a click focuses it
// with Herdr's own `pane.focus`, which the mod can't follow, so the block's next look marks it
// seen if that terminal is in front and unread. Each is kept an hour.
export const NOTIFIED_FOR_MS = 60 * 60_000;
export function seenAfterNotice(notified, focusedTerminal, live, now = Date.now()) {
  const kept = {};
  for (const [t, at] of Object.entries(notified ?? {})) if (now - at < NOTIFIED_FOR_MS) kept[t] = at;
  const row = focusedTerminal && kept[focusedTerminal] != null ? (live ?? []).find((r) => r.terminal === focusedTerminal && (r.host ?? "herdr") === "herdr") : null;
  if (row?.unread !== true) return { seen: null, notified: kept };
  delete kept[focusedTerminal];
  return { seen: seenArgs(focusedTerminal), notified: kept };
}
