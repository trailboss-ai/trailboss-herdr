// Shared by every Trailboss view: finding and running the CLI, and formatting.
import { exec, home } from "herdr";

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

export const MISSING = "The trailboss CLI isn't installed (cargo install --path <Trailboss repo>)";

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
