// node integrations/herdr/mods/trailboss/diff.test.mjs
// Hunk patches are checked by applying them with real git in a scratch repository.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff, hunkPatch, counts, rows, parseStatus } from "./diff.js";

const dir = mkdtempSync(join(tmpdir(), "trailboss-diff-"));
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const apply = (patch, ...flags) => {
  const p = join(dir, ".patch");
  writeFileSync(p, patch);
  git("apply", ...flags, p);
  rmSync(p);
};

try {
  git("init", "-q");
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  writeFileSync(join(dir, "f.txt"), `${lines.join("\n")}\n`);
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  // Two changes far apart: two hunks.
  const changed = [...lines];
  changed[2] = "line 3, changed";
  changed[25] = "line 26, changed";
  writeFileSync(join(dir, "f.txt"), `${changed.join("\n")}\n`);

  let d = parseDiff(git("diff", "--no-color", "--", "f.txt"));
  assert.equal(d.hunks.length, 2);
  assert.deepEqual(counts(d), { add: 2, del: 2 });
  const r = rows(d);
  assert.equal(r[0].kind, "@");
  assert.equal(r.find((x) => x.kind === "+").text, "line 3, changed");
  assert.equal(r.find((x) => x.kind === "+").now, 3);

  // Stage only the first hunk.
  apply(hunkPatch(d, 0), "--cached");
  const staged = git("diff", "--cached", "--no-color");
  assert.match(staged, /line 3, changed/);
  assert.doesNotMatch(staged, /line 26, changed/);

  // Unstage it again, from the staged diff.
  const s = parseDiff(git("diff", "--cached", "--no-color", "--", "f.txt"));
  apply(hunkPatch(s, 0), "--cached", "-R");
  assert.equal(git("diff", "--cached"), "");

  // Discard the second hunk from the working tree; the first stays.
  d = parseDiff(git("diff", "--no-color", "--", "f.txt"));
  apply(hunkPatch(d, 1), "-R");
  const now = readFileSync(join(dir, "f.txt"), "utf8");
  assert.match(now, /line 3, changed/);
  assert.match(now, /^line 26$/m);

  // Status with a branch line, an untracked file and a rename.
  const st = parseStatus("## main...origin/main [ahead 1]\0 M f.txt\0?? new.txt\0R  b.txt\0a.txt\0");
  assert.equal(st.branch, "main...origin/main [ahead 1]");
  assert.deepEqual(st.files.map((f) => `${f.x}${f.y} ${f.path}`), [" M f.txt", "?? new.txt", "R  b.txt"]);

  assert.deepEqual(parseDiff("Binary files a/x and b/x differ\n").hunks, []);
  console.log("diff.test.mjs: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
