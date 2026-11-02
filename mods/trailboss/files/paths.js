// Path rules for the Files panel, pure so paths.test.mjs can run them under node.

export const parentOf = (p) => p.replace(/\/[^/]+$/, "") || "/";
export const inside = (root, p) => p === root || p.startsWith(`${root}/`);

/** `name` under `dir`, normalized, or null if it would leave `root`. */
export function within(root, dir, name) {
  const p = `${dir}/${name}`.replace(/\/\.\//g, "/").replace(/\/+/g, "/");
  return p.includes("/../") || p.endsWith("/..") || !inside(root, p) ? null : p;
}

/** Where dropping `from` onto folder `to` moves it, or null when that isn't a move:
 *  the same folder, itself, one of its own subfolders, or outside `root`. */
export function dropDest(root, from, to) {
  if (!from || !to || parentOf(from) === to || to === from || to.startsWith(`${from}/`)) return null;
  return within(root, to, from.split("/").pop());
}
