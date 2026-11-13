// Shared by every Trailboss view: finding and running the CLI, and formatting.
import { exec, home, appHome, readTextFile } from "herdr";
import { NEEDS, cliProblem, problemText, hasBlock } from "./cli.js";

export const MOD = "trailboss";
// The Trailboss mark (docs/brand/mark.svg), as a path in Herdr's home folder.
export const ICON = `mods/${MOD}/icons/trailboss.svg`;

// Apps started from a desktop launcher can miss ~/.cargo/bin on PATH.
let found;
export async function findBin() {
  if (found !== undefined) return found;
  for (const b of ["trailboss", `${home()}/.cargo/bin/trailboss`, `${home()}/.local/bin/trailboss`]) {
    try {
      if ((await exec(b, ["--version"])).code === 0) return (found = b);
    } catch {}
  }
  return (found = null);
}

export const MISSING = "The trailboss CLI isn't installed: open the Trailboss dashboard and click Install";

// Whether the CLI found works with this mod: { bin, version, problem, text }. `problem` is
// null when it does; otherwise the views show `text` with an Install / Update button.
export async function cliStatus() {
  const bin = await findBin();
  let v = null;
  if (bin) {
    try {
      const r = await exec(bin, ["--json", "version"]);
      if (r.code === 0) v = JSON.parse(r.stdout);
    } catch {}
  }
  const problem = cliProblem(bin, v);
  return { bin, version: v?.version ?? null, problem, text: problemText(problem, v) };
}

// Whether the current layout has the status-bar block; null when that can't be read.
export async function blockInLayout() {
  try {
    const sh = JSON.parse((await readTextFile(`${appHome()}/shared.json`)) ?? "{}");
    const text = await readTextFile(`${appHome()}/layouts/${sh.layout || "main"}.json`);
    return text ? hasBlock(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

// Runs one of setup_mod.py's steps ("get-cli", "add-block", "record"), which ships in this
// folder so it works however the mod was installed. get-cli and add-block only ever on a click.
// { ok, message }.
export async function setupStep(step) {
  const args = [`${appHome()}/mods/${MOD}/setup_mod.py`, step, ...(step === "get-cli" ? ["--min", NEEDS.version] : [])];
  let r;
  try {
    r = await exec("python3", args);
  } catch (e) {
    return { ok: false, message: `Couldn't run python3: ${e?.message ?? e}` };
  }
  if (step === "get-cli") found = undefined; // look for the binary again
  const out = ((r.code === 0 ? r.stdout : r.stderr || r.stdout) || "").trim().split("\n").pop();
  return { ok: r.code === 0, message: out || (r.code === 0 ? "Done" : `${step} failed`) };
}

// The install record (data/trailboss/install.json) for `trailboss doctor`, written once per
// Herdr start when there's none, as after a package-manager install, which never runs
// install.py. It stays inside Herdr's folder, so it needs no click; it never replaces
// install.py's record.
// Tried again on the next open if it failed.
let recording = null;
export function recordInstall() {
  recording ??= setupStep("record").then((r) => {
    if (!r.ok) recording = null;
  });
  return recording;
}

// Runs `trailboss --json <args>` and parses its output.
export async function tb(args) {
  const bin = await findBin();
  if (!bin) throw new Error(MISSING);
  const r = await exec(bin, ["--json", ...args]);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout).trim().split("\n").pop();
    throw new Error(msg || `trailboss ${args[0]} failed`);
  }
  return JSON.parse(r.stdout);
}

export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const money = (x) => (x == null ? "—" : `$${x >= 100 ? Math.round(x).toLocaleString("en") : x.toFixed(2)}`);
export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));
export const short = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ""));
export const err = (e) => String(e?.message ?? e);

// 1.2K, 3.4M, 5.6B, 7T: compact enough for a tile.
export function compact(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (a >= v) {
      const x = n / v;
      return `${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1) : x.toFixed(2)}${s}`;
    }
  }
  return Math.round(n).toLocaleString("en");
}

// 2h 13m, 4d 3h, 45s.
export function duration(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 1) return "<1s";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d}d ${h % 24}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

// now, 5m, 3h, 2d, 4mo: how long ago an ISO time was.
export function age(iso) {
  const ms = Date.now() - Date.parse(iso ?? "");
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (d < 31) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

// "Wkd, Mon D, YYYY" for a YYYY-MM-DD.
export function longDate(day) {
  const [y, m, d] = (day ?? "").split("-").map(Number);
  if (!y) return day ?? "";
  return new Date(y, m - 1, d).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function monthDay(day) {
  const [y, m, d] = (day ?? "").split("-").map(Number);
  if (!y) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en", { month: "short", day: "numeric" });
}

// A shell-safe rendering of an argv, for "copy command".
export const shellWords = (argv) =>
  argv.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");

export function statusColor(t, status) {
  if (!status) return t.dim;
  if (status === "working" || status === "busy") return t.working;
  if (status === "blocked") return t.blocked;
  if (status === "done") return t.done;
  if (status.startsWith("lost") || status === "suspended") return t.blocked;
  return t.idle;
}
