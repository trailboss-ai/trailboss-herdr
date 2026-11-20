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

// A row's load stands out from this much CPU (percent of one core: a core kept busy) or
// resident memory (an agent's tree usually holds a few hundred MB); below, it stays dim.
export const CPU_HIGH = 100;
export const RSS_HIGH = 2 * 2 ** 30;

// Its processes' load, when known: [["38% cpu", false], ["2.4 GB", true]], each with whether
// it's high.
export function loadParts(r) {
  const out = [];
  if (r.cpu_pct != null) out.push([`${Math.round(r.cpu_pct)}% cpu`, r.cpu_pct >= CPU_HIGH]);
  if (r.rss_bytes != null) {
    const mb = r.rss_bytes / 2 ** 20;
    out.push([mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`, r.rss_bytes >= RSS_HIGH]);
  }
  return out;
}

// "38% cpu · 584 MB": its processes' load, when known.
export const resources = (r) => loadParts(r).map(([text]) => text).join(" · ");

// "2 background shells", "1 background monitor", "3 background jobs" when they're of several
// kinds; null when it left none running (or `live` can't tell).
const JOB_KINDS = { shell: ["shell", "shells"], monitor: ["monitor", "monitors"], process: ["process", "processes"] };
export function backgroundText(r) {
  const jobs = r.background ?? [];
  if (!jobs.length) return null;
  const kind = jobs.every((j) => j.kind === jobs[0].kind) ? JOB_KINDS[jobs[0].kind] : null;
  const [one, many] = kind ?? ["job", "jobs"];
  return `${jobs.length} background ${jobs.length === 1 ? one : many}`;
}

// The tooltip for those: one line each, "shell · npm run dev · 12m".
export function backgroundTip(r, now = Date.now()) {
  return (r.background ?? []).map((j) => [j.kind, j.label, ago(j.since, now)].filter(Boolean).join(" · ")).join("\n");
}

// Working with no progress for a while: ["stuck 12m", "blocked"] when its processes are idle,
// ["busy 12m", "working"] when they're busy (a long build or test run); [label, tone], tone a
// theme color name. null otherwise.
export function quietText(r) {
  const m = r.quiet_min != null ? ` ${r.quiet_min}m` : "";
  if (r.stuck) return [`stuck${m}`, "blocked"];
  if (r.quiet_busy) return [`busy${m}`, "working"];
  return null;
}

// `trailboss live --pin` for a row: its terminal, else its session (what `--pin` takes);
// null for a row with no agent, or neither.
export function pinArgs(r) {
  const what = r?.agent ? (r.terminal ?? r.session) : null;
  return what ? ["live", "--pin", what] : null;
}

// `trailboss live --unpin` for a row, named as for --pin: the CLI takes the terminal or the
// session of a pinned row, whichever it was pinned by, so one call does. Null when there's
// nothing to name.
export function unpinArgs(r) {
  const what = r?.agent ? (r.terminal ?? r.session) : null;
  return what ? ["live", "--unpin", what] : null;
}

// The toggles on a Live row, each [label, calls, tooltip]: Quiet / Unquiet and Settle /
// Unsettle (`live --quiet|--unquiet|--settle|--unsettle`, only when the CLI says whether the
// row is quiet or settled: an older one doesn't), then Pin / Unpin. A row with no agent has
// none.
export function rowToggles(r) {
  const name = pinArgs(r)?.[2];
  if (!name) return [];
  const out = [];
  if (typeof r.quiet === "boolean")
    out.push(
      r.quiet
        ? ["Unquiet", [["live", "--unquiet", name]], "Count its finished turns and questions as needing you again (trailboss live --unquiet)"]
        : ["Quiet", [["live", "--quiet", name]], "A background worker: its finished turns and questions don't need you; approvals and errors still do (trailboss live --quiet)"],
    );
  if (typeof r.settled === "boolean")
    out.push(
      r.settled
        ? ["Unsettle", [["live", "--unsettle", name]], "Put it back on the board (trailboss live --unsettle)"]
        : ["Settle", [["live", "--settle", name]], "Off the board until it needs you, finishes or starts a turn (trailboss live --settle)"],
    );
  out.push(r.pinned ? ["Unpin", [unpinArgs(r)], "Let it go back among the others (trailboss live --unpin)"] : ["Pin", [pinArgs(r)], "Keep it at the top (trailboss live --pin)"]);
  return out;
}

// The words before a row's reason or turn: "pinned · quiet · settled · ".
export const markers = (r) => ["pinned", "quiet", "settled"].filter((k) => r[k] === true).map((k) => `${k} · `).join("");

// A spending alert, short: "$12.35 > $10 session", "$31.20 > $30 folder"; null when there's
// none (or a CLI without spending alerts).
const usd = (x) => (Number.isInteger(x) ? `$${x}` : `$${x.toFixed(2)}`);
export function alertText(a) {
  if (!a || typeof a.amount_usd !== "number" || typeof a.limit_usd !== "number") return null;
  return `$${a.amount_usd.toFixed(2)} > ${usd(a.limit_usd)}${a.limit ? ` ${a.limit}` : ""}`;
}

// What it means, on hover, with the config key that set the limit.
const LIMITS = {
  session: "This session has cost more than the session limit (alerts.session_usd)",
  folder: "Agents in this folder have cost more than the folder limit today (alerts.folder_usd)",
  day: "Agents have cost more than the day limit today (alerts.day_usd)",
};
export const alertTip = (a) => (a ? `${LIMITS[a.limit] ?? `Over the ${a.limit} spending limit`}, at API prices` : "");

// A spend_alert event as a notification's { title, body }; null when it carries no alert.
// A session's names its agent, a folder's its folder; a day's is everyone's.
export function spendNotice(e) {
  const text = alertText(e?.alert);
  if (!text) return null;
  const who = `${e.agent ?? ""} ${e.where ?? ""}`.trim();
  const body =
    e.alert.limit === "folder" ? (e.cwd ?? "")
    : e.alert.limit === "day" ? "All agents today"
    : [who, e.title ?? e.cwd].filter(Boolean).join(" · ");
  return { title: `Spending alert: ${text}`, body };
}
