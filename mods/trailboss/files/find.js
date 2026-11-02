// Find and replace in a text, pure so find.test.mjs can run it under node.

function pattern(query, { caseSensitive = false, regex = false } = {}) {
  const src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(src, caseSensitive ? "g" : "gi"); // throws on a bad regex
}

/** Every match: index, length, 1-based line and column, and the line's text. */
export function findAll(text, query, opts, max = 5000) {
  if (!query) return [];
  const re = pattern(query, opts);
  const out = [];
  let line = 1, lineStart = 0, scanned = 0;
  for (const m of text.matchAll(re)) {
    if (m[0] === "") break; // an empty match (e.g. /x*/) would never end
    for (let i = scanned; i < m.index; i++) if (text[i] === "\n") (line++, (lineStart = i + 1));
    scanned = m.index;
    const end = text.indexOf("\n", m.index);
    out.push({ index: m.index, length: m[0].length, line, col: m.index - lineStart + 1, text: text.slice(lineStart, end < 0 ? undefined : end) });
    if (out.length >= max) break;
  }
  return out;
}

/** Replace the first match at or after `from`; `{ text, at, line }` or null if none. */
export function replaceNext(text, query, replacement, opts, from = 0) {
  const ms = findAll(text, query, opts);
  const m = ms.find((x) => x.index >= from) ?? ms[0]; // wrap around
  if (!m) return null;
  const re = pattern(query, opts);
  const one = text.slice(m.index, m.index + m.length).replace(new RegExp(re.source, re.flags.replace("g", "")), replacement);
  return { text: text.slice(0, m.index) + one + text.slice(m.index + m.length), at: m.index + one.length, line: m.line };
}

/** Replace every match: `{ text, count }`. */
export function replaceAll(text, query, replacement, opts) {
  if (!query) return { text, count: 0 };
  const count = findAll(text, query, opts, Infinity).length;
  return { text: count ? text.replace(pattern(query, opts), replacement) : text, count };
}
