// One file's `git diff` as a header and hunks, the patch that stages, unstages or discards
// one hunk, and numbered rows to draw. Pure: diff.test.mjs runs it under node with real git.

/** `{ header: string[], hunks: [{ head, lines }] }` from one file's unified diff. */
export function parseDiff(text) {
  const lines = (text ?? "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const first = lines.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return { header: lines, hunks: [] };
  const hunks = [];
  for (const l of lines.slice(first)) {
    if (l.startsWith("@@")) hunks.push({ head: l, lines: [] });
    else hunks.at(-1).lines.push(l);
  }
  return { header: lines.slice(0, first), hunks };
}

/** A patch with only hunk `i`, for `git apply` (with `--cached` and / or `-R`). */
export function hunkPatch(d, i) {
  const h = d.hunks[i];
  return `${[...d.header, h.head, ...h.lines].join("\n")}\n`;
}

/** Lines added and removed in a parsed diff. */
export function counts(d) {
  let add = 0, del = 0;
  for (const h of d.hunks)
    for (const l of h.lines) {
      if (l[0] === "+") add++;
      else if (l[0] === "-") del++;
    }
  return { add, del };
}

/** Rows to draw: hunk heads (with their index) and lines numbered old / new. */
export function rows(d) {
  const out = [];
  d.hunks.forEach((h, hunk) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(h.head);
    let old = m ? +m[1] : 0, now = m ? +m[2] : 0;
    out.push({ kind: "@", text: h.head, hunk });
    for (const l of h.lines) {
      const k = l[0];
      if (k === "-") out.push({ kind: "-", old: old++, text: l.slice(1) });
      else if (k === "+") out.push({ kind: "+", now: now++, text: l.slice(1) });
      else if (k === " ") out.push({ kind: " ", old: old++, now: now++, text: l.slice(1) });
      else out.push({ kind: "\\", text: l });
    }
  });
  return out;
}

/** `git status --porcelain=v1 -z -b` as `{ branch, files: [{ path, x, y }] }`. */
export function parseStatus(raw) {
  const fields = (raw ?? "").split("\0").filter(Boolean);
  let branch = null;
  const files = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.startsWith("## ")) {
      branch = f.slice(3);
      continue;
    }
    const x = f[0], y = f[1];
    files.push({ path: f.slice(3), x, y });
    if (x === "R" || x === "C") i++; // the old path follows a rename or copy
  }
  return { branch, files };
}
