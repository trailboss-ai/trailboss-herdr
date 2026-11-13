// What a Live row says about its agent, from `trailboss live`'s fields: why it needs you,
// its turn, model, effort, context and processes. Pure, so live.test.mjs runs it under node.

// Most urgent first: an agent that needs you (or looks stuck), then one that finished,
// working, at rest. Anything else (a lost terminal, an unknown status) comes last.
export function rank(r) {
  if (r.status === "blocked" || r.needs || r.stuck) return 0;
  if (r.status === "done") return 1;
  if (r.status === "working" || r.status === "busy") return 2;
  if (r.status === "idle") return 3;
  return 4;
}

// Each `needs_kind` in a person's words, for when the reason mustn't quote the transcript
// (the CLI's own notifications say the same).
const KINDS = {
  plan: "Plan to approve",
  question: "Question",
  run: "Run a command",
  edit: "Edit a file",
  read: "Read a file",
  fetch: "Fetch a page",
  search: "Search the web",
  tool: "Use a tool",
  rate_limit: "Rate limited",
  error: "Error",
  waiting: "Waiting for you",
  reply: "Asked you something",
};

// Why a row or event needs you, for someone who may not be the user (a notification, a
// tooltip): only the kind of request, unless `details` (the config's notifications.details).
// null when it doesn't need you.
export function needsWords(r, details = false) {
  if (!r?.needs) return null;
  if (details) return r.needs;
  return KINDS[r.needs_kind] ?? "Waiting for you";
}

// Shared state the status-bar block keeps for the spaces sidebar's tooltips: why each Herdr
// terminal's agent needs you, { terminal: [{ agent, why }] }. Only the kind, even with
// details on: shared state is saved to disk, and the reason quotes the transcript.
export const NEEDS_KEY = "trailboss.needs";
export function needsByTerminal(live) {
  const out = {};
  for (const r of live ?? []) {
    const why = needsWords(r);
    if (!why || !r.terminal || (r.host ?? "herdr") !== "herdr") continue;
    (out[r.terminal] ??= []).push({ agent: r.agent, why });
  }
  return out;
}

// The config's notifications.details: only `true` turns it on, as in the CLI.
export const detailsOn = (config) => config?.notifications?.details === true;

// 45s, 12m, 3h, 2d: how long ago `ms` (since the epoch) was; "" when unknown or ahead.
export function ago(ms, now = Date.now()) {
  if (ms == null || !(now - ms >= 0)) return "";
  const s = Math.floor((now - ms) / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 60) return `${s}s`;
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return `${d}d`;
}

// "blocked 12m": the status and how long the agent has been in it.
export const statusFor = (r, now = Date.now()) => [r.status, ago(r.status_since, now)].filter(Boolean).join(" ");

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const FAMILIES = new Set(["opus", "sonnet", "haiku", "fable"]);

// A model as people say it: claude-opus-5-5 → Opus 5.5, claude-3-5-sonnet-20241022 →
// Sonnet 3.5, gpt-5.1-codex → GPT-5.1 Codex, gemini-2.5-pro → Gemini 2.5 Pro. Anything else
// as the agent names it.
export function modelName(id) {
  if (!id) return null;
  const m = id.replace(/\[[^\]]*\]$/, "").replace(/^[a-z]+\.anthropic\./, "").replace(/-v\d+(:\d+)?$/, "").replace(/-\d{8}$/, "");
  const parts = m.split("-");
  if (parts[0] === "claude") {
    const rest = parts.slice(1);
    const fam = rest.findIndex((p) => FAMILIES.has(p));
    if (fam < 0) return id;
    const nums = rest.filter((p, i) => i !== fam && /^\d+$/.test(p));
    return [cap(rest[fam]), nums.join(".")].filter(Boolean).join(" ");
  }
  if (parts[0] === "gpt") return [`GPT-${parts[1] ?? ""}`, ...parts.slice(2).map(cap)].join(" ");
  if (parts[0] === "gemini") return ["Gemini", ...parts.slice(1).map(cap)].join(" ");
  return id;
}

// The effort as a word: high → High, xhigh → XHigh.
export const effortName = (e) => (!e ? null : e === "xhigh" ? "XHigh" : cap(e));

// Above this much of its window, the context's share stands out.
export const CONTEXT_WARN = 80;

// "38% context", or "380K context" when the window is unknown; null when neither is.
export function contextText(r) {
  if (r.context_pct != null) return `${r.context_pct}% context`;
  if (r.context_tokens != null) return `${Math.round(r.context_tokens / 1000)}K context`;
  return null;
}

// What the agent runs as: ["Opus 5.5", "High", "38% context"], whichever are known.
export const modelParts = (r) => [modelName(r.model), effortName(r.effort), contextText(r)].filter(Boolean);

// The turn, when the row has no reason it needs you: "turn 7", "turn 4 ended 3m ago".
export function turnText(r, now = Date.now()) {
  if (r.turn == null) return "";
  if (r.turn_ended_ms == null) return `turn ${r.turn}`;
  const a = ago(r.turn_ended_ms, now);
  return `turn ${r.turn} ended${a ? ` ${a} ago` : ""}`;
}

// "38% cpu · 584 MB": its processes' load, when known.
export function resources(r) {
  const out = [];
  if (r.cpu_pct != null) out.push(`${Math.round(r.cpu_pct)}% cpu`);
  if (r.rss_bytes != null) {
    const mb = r.rss_bytes / 2 ** 20;
    out.push(mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
  }
  return out.join(" · ");
}
