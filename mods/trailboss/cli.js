// Which Trailboss CLI this mod works with (pure, so node can test it: cli.test.mjs).

// The oldest CLI this mod works with, and the --json version (`trailboss --json version`'s
// `api`) it reads. Raise `version` when the mod starts using a field a release added.
export const NEEDS = { version: "0.4.0", api: 1 };

// a < b, comparing 0.10.0 > 0.9.9 as numbers; a pre-release suffix (-rc1) is ignored.
export function older(a, b) {
  const p = (v) => String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}

// What's wrong with the CLI found, from `trailboss --json version` (null when it has no such
// command, i.e. it predates it): null when it's fine, else "missing", "old" or "newer-api".
export function cliProblem(found, v, needs = NEEDS) {
  if (!found) return "missing";
  if (!v?.version || older(v.version, needs.version)) return "old";
  // A newer api renamed or removed something this mod reads: the mod needs updating.
  if (v.api > needs.api) return "newer-api";
  return null;
}

// The status line for a problem.
export function problemText(problem, v, needs = NEEDS) {
  if (problem === "missing") return "Trailboss isn't installed";
  // No `version` command at all: older than any release this mod can name.
  if (problem === "old") return v?.version ? `Trailboss ${needs.version} needed (have ${v.version})` : "A newer Trailboss is needed";
  if (problem === "newer-api") return `Update the Trailboss mod for Trailboss ${v?.version}`;
  return "";
}

// Whether a layout has Trailboss's status-bar block (the mod with no `view`): tracking and
// resume only run while it's shown.
export function hasBlock(node) {
  if (Array.isArray(node)) return node.some(hasBlock);
  if (!node || typeof node !== "object") return false;
  if (node.type === "block" && node.content?.mod === "trailboss" && !node.content?.props?.view) return true;
  return Object.values(node).some(hasBlock);
}
