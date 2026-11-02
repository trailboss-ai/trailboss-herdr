import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { MOD, tb, err } from "./lib.js";

// Plan quotas in the status bar, with a detail popup per provider and a provider picker
// (what the usage-bar mod did). The strip refreshes every 2 minutes and shares its
// result, so the popups and other copies don't ask again.

const PROVIDERS = ["codex", "claude", "cursor"];
const NAMES = { codex: "Codex", claude: "Claude", cursor: "Cursor" };
const REFRESH_MS = 120000;
const KEY = "trailboss.quota";
const ENABLED = "trailboss.quota.providers";
const COUNTDOWNS = "trailboss.quota.countdowns";

const enabled = () => shared(ENABLED) ?? PROVIDERS;
const countdowns = () => ({ codex: true, claude: true, cursor: false, ...(shared(COUNTDOWNS) ?? {}) });
const snapshot = () => shared(KEY) ?? { at: null, rows: [], pending: false };

async function refresh(only) {
  const before = snapshot();
  setShared(KEY, { ...before, pending: true });
  try {
    const rows = await tb(["quota", ...(only?.length ? ["--provider", only.join(",")] : [])]);
    // A refresh of some providers keeps the others' rows.
    const kept = only?.length ? before.rows.filter((r) => !only.includes(r.provider)) : [];
    setShared(KEY, { at: Date.now(), rows: [...kept, ...rows], pending: false, error: null });
  } catch (e) {
    setShared(KEY, { ...before, pending: false, error: err(e) });
  }
}

function pct(u) {
  if (u > 0 && u < 1) return "<1%";
  if (u > 99 && u < 100) return ">99%";
  return `${Math.round(u)}%`;
}

const level = (t, u) => (u >= 95 ? t.blocked : u >= 75 ? t.working : t.foreground);

function until(resetsAt) {
  if (!resetsAt) return null;
  const s = resetsAt - Date.now() / 1000;
  if (s <= 0) return "Reset pending";
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d}d ${h % 24}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

const WINDOW_NAMES = { "5h": "Current · 5 hours", "7d": "Weekly · 7 days", "30d": "Monthly · 30 days", Auto: "Auto models", Other: "Other models" };
const windowName = (label) =>
  WINDOW_NAMES[label] ?? (label?.startsWith("7d ") ? `Weekly · ${label.slice(3)[0].toUpperCase()}${label.slice(4)}` : label);

// What a provider's rows say: its windows, or why there are none.
function state(provider) {
  const rows = snapshot().rows.filter((r) => r.provider === provider);
  return {
    rows,
    windows: rows.filter((r) => r.window),
    note: rows.find((r) => r.note)?.note ?? null,
    plan: rows[0]?.plan ?? null,
    credits: rows.find((r) => r.credits)?.credits ?? null,
  };
}

// Errors from trailboss, as a heading and what to do.
function explain(provider, note) {
  if (!note) return ["Not signed in", `Sign in to ${NAMES[provider]} on this machine, then refresh.`];
  if (note.includes("expired")) return ["Sign-in expired", `Open ${NAMES[provider]} once to refresh its sign-in.`];
  if (note.includes("refused")) return ["Usage access refused", "This account can't read its usage."];
  if (note.includes("scope")) return ["Usage permission missing", note];
  if (note.includes("rate limited")) return ["Try again later", note];
  if (note.includes("offline")) return ["Offline", "Check the connection, then refresh."];
  return ["Usage unavailable", note];
}

const openDetail = (provider) =>
  openOverlay({
    mod: MOD,
    props: { view: "quota-detail", provider },
    kind: "popup",
    width: 480,
    height: provider === "claude" ? 400 : 460,
  });

export class QuotaStrip {
  init(_p, cx) {
    this.width = 1000;
    cx.spawn(async (cx) => {
      await refresh(enabled());
      cx.notify();
    });
    cx.timer.every(REFRESH_MS, (cx) => cx.spawn(async () => refresh(enabled())));
    // Countdowns tick down.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  chip(t, provider, compact) {
    const s = state(provider);
    const timers = countdowns()[provider] && !compact;
    const parts = s.windows.length
      ? s.windows.flatMap((w, i) => [
          ...(i ? [div().text_color(t.border).child("·")] : []),
          h_flex()
            .gap(3)
            .child(div().text_color(t.muted).child(w.window))
            .child(div().text_color(level(t, w.used_percent)).child(pct(w.used_percent)))
            .when(Boolean(timers && w.resets_at), (el) => el.child(div().text_color(t.dim).child(`(${until(w.resets_at)})`))),
        ])
      : [div().text_color(s.rows.length ? t.blocked : t.dim).child(s.rows.length ? "!" : "…")];
    return h_flex()
      .id(`chip-${provider}`)
      .gap(5)
      .px(6)
      .rounded(4)
      .items_center()
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click(() => openDetail(provider))
      .child(div().text_color(t.foreground).child(compact ? NAMES[provider][0] : NAMES[provider]))
      .children(parts);
  }

  render() {
    const t = theme();
    const on = enabled();
    const compact = this.width < 700;
    const snap = snapshot();
    return h_flex()
      .id("root")
      .on_size_change((size, cx) => {
        this.width = size.width;
        cx.notify();
      })
      .size_full()
      .px(8)
      .gap(6)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .child(
        div()
          .id("pick")
          .cursor_pointer()
          .px(4)
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click(() => openOverlay({ mod: MOD, props: { view: "quota-picker" }, kind: "popup", width: 310, height: 275 }))
          .child("◔"),
      )
      .when(on.length === 0, (el) =>
        el.child(
          div()
            .id("choose")
            .cursor_pointer()
            .text_color(t.muted)
            .on_click(() => openOverlay({ mod: MOD, props: { view: "quota-picker" }, kind: "popup", width: 310, height: 275 }))
            .child("Choose providers"),
        ),
      )
      .children(PROVIDERS.filter((p) => on.includes(p)).map((p) => this.chip(t, p, compact)))
      .child(
        div()
          .id("refresh")
          .cursor_pointer()
          .px(4)
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => cx.spawn(async (cx) => {
            await refresh(enabled());
            cx.notify();
          }))
          .child(snap.pending ? "…" : "↻"),
      )
      .when(this.width > 760, (el) => el.child(div().text_color(t.dim).child("quota used")));
  }
}

export class QuotaDetail {
  init(p) {
    this.provider = p.provider;
    this.overlay = p.overlay;
  }

  render() {
    const t = theme();
    const p = this.provider;
    const s = state(p);
    const snap = snapshot();
    const on = countdowns()[p];
    const desc =
      p === "cursor"
        ? "Your Cursor plan's usage this billing cycle, from the sign-in Cursor stores on this machine."
        : `The rolling limits ${NAMES[p] === "Claude" ? "Anthropic" : "OpenAI"} reports for your ${NAMES[p]} sign-in.`;
    const body = [];
    if (!s.windows.length) {
      const [head, text] = explain(p, snap.pending && !s.rows.length ? null : s.note);
      body.push(div().pt(6).text_size(13).font_semibold().child(snap.pending ? "Reading usage…" : head));
      if (!snap.pending) body.push(div().text_size(12).text_color(t.muted).child(text));
    }
    s.windows.forEach((w, i) => {
      const left = until(w.resets_at);
      body.push(
        v_flex()
          .id(`w-${i}`)
          .gap(4)
          .pt(8)
          .child(
            h_flex()
              .justify_between()
              .child(div().text_size(12.5).font_semibold().child(windowName(w.window)))
              .child(div().text_size(12.5).text_color(level(t, w.used_percent)).child(`${pct(w.used_percent)} used`)),
          )
          .child(
            div()
              .h(4)
              .rounded(2)
              .bg(t.border)
              .child(div().h_full().rounded(2).bg(level(t, w.used_percent)).w(Math.round(4.4 * Math.min(100, w.used_percent)))),
          )
          .child(
            h_flex()
              .justify_between()
              .text_size(11.5)
              .text_color(t.dim)
              .child(left ? (left === "Reset pending" ? left : `Resets in ${left}`) : "")
              .child(w.pace ? `on pace for ${w.pace.replace(" ⚠", "")}` : "")
              .child(w.resets_at ? `Resets ${new Date(w.resets_at * 1000).toLocaleString()}` : ""),
          ),
      );
    });
    if (p === "codex") {
      const c = s.credits;
      const text =
        c === "unlimited" ? "Unlimited" : c === "available" ? "Available · balance not reported" : c === "none" ? "No remaining credits" : c ?? "Not reported";
      body.push(
        v_flex()
          .pt(10)
          .gap(2)
          .child(h_flex().justify_between().text_size(12.5).child(div().font_semibold().child("Credits remaining")).child(text))
          .child(div().text_size(11.5).text_color(t.dim).child("Additional usage credits, separate from your plan's rolling limits.")),
      );
    }
    return v_flex()
      .id("root")
      .size_full()
      .p(14)
      .gap(4)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(div().text_size(14).font_semibold().child(`${NAMES[p]} usage${s.plan ? ` · ${s.plan}` : ""}`))
          .child(
            div()
              .id("close")
              .cursor_pointer()
              .px(8)
              .rounded(4)
              .text_size(12)
              .text_color(t.muted)
              .hover((st) => st.bg(t.hover))
              .on_click(() => closeOverlay(this.overlay))
              .child("Close"),
          ),
      )
      .child(div().text_size(12).text_color(t.muted).child(desc))
      .children(body)
      .child(div().flex_1())
      .child(
        h_flex()
          .id("countdowns")
          .gap(6)
          .items_center()
          .cursor_pointer()
          .text_size(12)
          .on_click(() => setShared(COUNTDOWNS, { ...countdowns(), [p]: !on }))
          .child(div().text_color(on ? t.accent : t.dim).child(on ? "☑" : "☐"))
          .child("Show countdowns in bar"),
      )
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .pt(6)
          .text_size(11.5)
          .text_color(t.dim)
          .child(snap.at ? `Updated ${new Date(snap.at).toLocaleTimeString()} · refreshes every 2 minutes` : "Not read yet")
          .child(
            div()
              .id("refresh-all")
              .cursor_pointer()
              .px(8)
              .rounded(4)
              .bg(t.raised)
              .text_color(t.foreground)
              .hover((st) => st.bg(t.hover))
              .on_click((_e, cx) => cx.spawn(async (cx) => {
                await refresh(enabled());
                cx.notify();
              }))
              .child(snap.pending ? "Refreshing…" : "Refresh all"),
          ),
      );
  }
}

export class QuotaPicker {
  init(p) {
    this.overlay = p.overlay;
  }

  render() {
    const t = theme();
    const on = enabled();
    return v_flex()
      .id("root")
      .size_full()
      .p(14)
      .gap(8)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(div().text_size(14).font_semibold().child("Usage providers"))
          .child(
            div()
              .id("close")
              .cursor_pointer()
              .px(8)
              .rounded(4)
              .text_size(12)
              .text_color(t.muted)
              .hover((s) => s.bg(t.hover))
              .on_click(() => closeOverlay(this.overlay))
              .child("Close"),
          ),
      )
      .child(div().text_size(12).text_color(t.muted).child("Choose which providers appear in the bar."))
      .children(
        PROVIDERS.map((p) =>
          h_flex()
            .id(`p-${p}`)
            .gap(8)
            .px(8)
            .py(5)
            .rounded(5)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              const next = on.includes(p) ? on.filter((x) => x !== p) : PROVIDERS.filter((x) => x === p || on.includes(x));
              setShared(ENABLED, next);
              // A provider just turned on is read now, not in 2 minutes.
              if (!on.includes(p)) cx.spawn(async () => refresh([p]));
            })
            .child(div().text_color(on.includes(p) ? t.accent : t.dim).child(on.includes(p) ? "✓" : "○"))
            .child(div().text_size(12.5).child(NAMES[p])),
        ),
      )
      .child(div().flex_1())
      .child(div().text_size(11.5).text_color(t.dim).child("Choices are saved. Hidden providers stop automatic refresh."));
  }
}
