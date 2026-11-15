// The thread pane's text work, pure so node can test it (turns.test.mjs).

// A reply as a Markdown quote, with a blank line under it for your comment.
export const quote = (text) => `${text.trim().split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}\n\n`;

// Turns whose prompt or reply has every word of `q` (any case).
export function matching(turns, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return turns;
  return turns.filter((t) => {
    const s = `${t.prompt}\n${t.reply}`.toLowerCase();
    return words.every((w) => s.includes(w));
  });
}

// Local YYYY-MM-DD of an ISO time, for a band per day.
export function day(iso) {
  const d = new Date(iso ?? "");
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Markdown as plain text, for a row's preview: links keep their text, emphasis and code marks go.
export const plain = (l) =>
  l.replace(/^```.*$/, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|`)/g, "").replace(/^(#+|>)\s*/, "");

// The first `n` non-empty lines of a text, as plain text, each cut short. It stops at the
// n-th: rows call it on every render, and a reply can run to thousands of lines.
export function lines(text, n, width = 200) {
  const out = [];
  const s = text ?? "";
  for (let at = 0; out.length < n && at <= s.length; ) {
    let end = s.indexOf("\n", at);
    if (end < 0) end = s.length;
    const l = plain(s.slice(at, end).trim()).trim();
    if (l) out.push(l.length > width ? `${l.slice(0, width - 1)}…` : l);
    at = end + 1;
  }
  return out;
}

// The fenced code blocks in a reply, for their copy buttons.
export const codeBlocks = (md) => [...(md ?? "").matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1].replace(/\n$/, ""));
