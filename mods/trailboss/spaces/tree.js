// What the spaces sidebar shows (pure, so node can test it: tree.test.mjs).
//
// `rows`: Herdr's spaces in its order, as the base mod computes them ({w, i, g, tree});
// `state`: `trailboss --json folders` ({folders, spaces}); `placed`: space id → folder id
// (null: top level), from `folders place`. Folders show in the state's order, subfolders
// before their spaces; spaces not in any folder come after, as Herdr groups them.

const NEEDS = new Set(["blocked", "done"]);

// The folders under `parent` (null: the top), in order.
export const childrenOf = (state, parent) => (state?.folders ?? []).filter((f) => (f.parent ?? null) === parent);

// `folder` and every folder inside it.
export function subtree(state, folder) {
  const out = [folder];
  for (const f of childrenOf(state, folder)) out.push(...subtree(state, f.id));
  return out;
}

// One folder's spaces and what they add up to, its subfolders included.
function rollup(state, folder, bySpace) {
  const ids = new Set(subtree(state, folder));
  const rows = [...bySpace.entries()].filter(([, f]) => ids.has(f)).map(([r]) => r);
  return {
    count: rows.length,
    working: rows.filter((r) => r.w.status === "working").length,
    // A folded folder still shows when something in it needs you.
    needs: rows.some((r) => NEEDS.has(r.w.status)),
  };
}

// Items to draw, top to bottom: {kind: "folder", folder, depth, count, working, needs} and
// {kind: "space", row, depth, folder}; `rest`: rows in no folder (none when focused).
// `focus`: a folder id to show alone.
export function layoutTree(rows, state, placed, focus = null) {
  const known = new Set((state?.folders ?? []).map((f) => f.id));
  const bySpace = new Map(rows.map((r) => [r, known.has(placed?.[r.w.id]) ? placed[r.w.id] : null]));
  const items = [];
  const walk = (parent, depth) => {
    for (const f of childrenOf(state, parent)) emit(f, depth);
  };
  const emit = (f, depth) => {
    items.push({ kind: "folder", folder: f, depth, ...rollup(state, f.id, bySpace) });
    if (f.folded) return;
    walk(f.id, depth + 1);
    for (const [r, at] of bySpace) if (at === f.id) items.push({ kind: "space", row: r, depth: depth + 1, folder: f.id });
  };
  const top = focus && known.has(focus) ? state.folders.find((f) => f.id === focus) : null;
  if (top) {
    emit(top, 0);
    return { items, rest: [] };
  }
  walk(null, 0);
  return { items, rest: rows.filter((r) => bySpace.get(r) === null) };
}

// Herdr's order for the spaces, following the sidebar: next/previous space then go down the
// list as it shows. Folded folders' spaces keep their place in that order.
export function spaceOrder(rows, state, placed) {
  const open = { ...state, folders: (state?.folders ?? []).map((f) => ({ ...f, folded: false })) };
  const { items, rest } = layoutTree(rows, open, placed);
  return [...items.filter((x) => x.kind === "space").map((x) => x.row), ...rest];
}

// Where a dragged folder may go: not into itself or below it, and not past four levels.
export function canMoveInto(state, id, into, max = 4) {
  if (into === null) return true;
  if (subtree(state, id).includes(into)) return false;
  const depth = (fid) => {
    let d = 0;
    for (let at = fid; at; at = state.folders.find((f) => f.id === at)?.parent ?? null) d++;
    return d;
  };
  const height = (fid) => 1 + Math.max(0, ...childrenOf(state, fid).map((f) => height(f.id)));
  return depth(into) + height(id) <= max;
}
