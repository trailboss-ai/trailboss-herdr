// Which plan windows to warn about: those on pace to run out before they reset, once per
// window (provider, window and reset time). `warned` is what was already warned about, kept
// in shared state so another copy of the block, or a restart, doesn't repeat it.
export function toWarn(rows, warned, nowS) {
  const keep = Object.fromEntries(Object.entries(warned ?? {}).filter(([, resetsAt]) => resetsAt > nowS));
  const warn = [];
  for (const q of rows ?? []) {
    if (!(q.pace_percent > 100) || !q.resets_at || q.resets_at <= nowS) continue;
    const key = `${q.provider}:${q.window}:${q.resets_at}`;
    if (key in keep) continue;
    keep[key] = q.resets_at;
    warn.push(q);
  }
  return { warn, warned: keep };
}

// "Claude 5h limit in ~40m at this pace".
export function warning(q) {
  const name = q.provider[0].toUpperCase() + q.provider.slice(1);
  return {
    title: `${name} ${q.window} limit ${q.limit_in ? `in ~${q.limit_in}` : "soon"} at this pace`,
    body: `${q.used} used, on pace for ${Math.round(q.pace_percent)}%; resets in ${q.resets_in ?? "?"}`,
  };
}
