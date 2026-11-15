// "Branch from here" in the thread pane: `trailboss branch` asks a side question in a fork of
// the session, as of one of its turns, in a new terminal. Without --yes it only prints the
// plan. Pure, so branch.test.mjs runs it under node.

// A question needs at least two words (the CLI refuses fewer); until then Start stays off.
export const words = (q) => (q ?? "").trim().split(/\s+/).filter(Boolean).length;
export const askable = (q) => words(q) >= 2;

/** `trailboss branch` arguments: fork `session` (AGENT:ID) as of `turn` with `question`;
 *  the plan unless `yes`. `--opt=value`, so a question is never read as an option. */
export function branchArgs(session, turn, question, yes = false, name = null) {
  return [
    "branch",
    session,
    ...(turn != null ? [`--at=${turn}`] : []),
    `--prompt=${(question ?? "").trim()}`,
    ...(name ? [`--name=${name}`] : []),
    ...(yes ? ["--yes"] : []),
  ];
}

// A CLI from before `branch` doesn't know the subcommand.
const UNKNOWN = /unrecognized subcommand '?branch'?/i;

/** What a `trailboss --json branch` run said, from its { code, stdout, stderr }:
 *  { row } (the plan, or what started), { unsupported: true } for a CLI without `branch`, or
 *  { error } with the CLI's own words (a refusal: an agent it can't fork, a turn it can't
 *  branch from, …). The JSON on stdout is read whatever the exit code. */
export function readBranch(r) {
  const out = (r?.stdout ?? "").trim();
  if (out.startsWith("[")) {
    try {
      const row = JSON.parse(out)[0];
      if (row && typeof row === "object") return { row };
    } catch {}
  }
  const text = `${r?.stderr ?? ""}\n${out.startsWith("[") ? "" : out}`.trim();
  if (UNKNOWN.test(text)) return { unsupported: true };
  const line = text.split("\n").map((s) => s.trim()).find((s) => s && !/^(Usage|For more information)/.test(s));
  return { error: (line ?? "").replace(/^(trailboss|error):\s*/, "") || `trailboss branch failed (exit ${r?.code ?? "?"})` };
}

// The card's lines for a plan or a start: what it does and the command it runs.
export function planText(row) {
  if (!row) return { detail: "", command: "" };
  const action = row.action && row.action !== "would branch" ? `${row.action}: ` : "";
  return { detail: `${action}${row.detail ?? ""}`, command: row.command ?? "" };
}
