import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared } from "herdr";
import { tb, err, money, monthDay } from "./lib.js";

// Your delivery numbers in the side panel (what the stats mod did), plus what agent work
// cost per pull request. GitHub is slow to ask, so results are kept for 30 minutes.

const KEY = "trailboss.stats";
const STALE_MS = 30 * 60000;
const CHECK_MS = 5 * 60000;
const AI_COLORS = { claude: "#d4704f", codex: "#3f86e0", both: "#1baf7a" };
const n = (x) => (x == null ? "—" : Number(x).toLocaleString("en"));

function ago(at) {
  if (!at) return "";
  const m = Math.floor((Date.now() - at) / 60000);
  return m < 1 ? "updated just now" : m < 60 ? `updated ${m}m ago` : `updated ${Math.floor(m / 60)}h ago`;
}

function hours(h) {
  if (h == null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round(h / 2.4) / 10}d`;
}

// ▲ +3 vs / ▼ −2 vs / • same as
function delta(t, now, before) {
  if (before == null) return null;
  const d = now - before;
  return d === 0
    ? [t.dim, "• same as"]
    : d > 0
      ? [t.done, `▲ +${d} vs`]
      : [t.blocked, `▼ −${Math.abs(d)} vs`];
}

export class Stats {
  init(_p, cx) {
    this.loading = false;
    this.error = null;
    cx.spawn((cx) => this.maybeLoad(cx));
    cx.timer.every(CHECK_MS, (cx) => cx.spawn((cx) => this.maybeLoad(cx)));
  }

  async maybeLoad(cx, force) {
    const c = shared(KEY);
    if (!force && c?.at && Date.now() - c.at < STALE_MS) return;
    await this.load(cx);
  }

  async load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    try {
      const s = (await tb(["stats"]))[0];
      setShared(KEY, { at: Date.now(), s });
      this.error = null;
    } catch (e) {
      this.error = err(e);
    } finally {
      this.loading = false;
    }
    cx.notify();
  }

  card(t, title, sub, children) {
    return v_flex()
      .gap(6)
      .p(10)
      .rounded(8)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .child(
        h_flex()
          .gap(6)
          .items_baseline()
          .child(div().text_size(12).font_semibold().child(title))
          .when(Boolean(sub), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(sub))),
      )
      .children(children);
  }

  tile(t, label, value, hint, d) {
    return v_flex()
      .flex_1()
      .min_w(0)
      .gap(2)
      .p(10)
      .rounded(8)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .child(div().text_size(10.5).text_color(t.dim).child(label))
      .child(div().text_size(20).font_semibold().child(String(value)))
      .when(Boolean(d), (el) => el.child(div().text_size(10.5).text_color(d[0]).child(`${d[1]} ${hint}`)))
      .when(!d && Boolean(hint), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(hint)));
  }

  bars(t, id, items, height, labelOf) {
    const max = Math.max(1, ...items.map((x) => x.v));
    const peak = items.reduce((m, x, i) => (x.v > items[m].v ? i : m), 0);
    return v_flex()
      .gap(3)
      .child(
        h_flex()
          .h(height)
          .gap(4)
          .items_end()
          .children(
            items.map((x, i) =>
              v_flex()
                .id(`${id}-${i}`)
                .flex_1()
                .h_full()
                .justify_end()
                .items_center()
                .gap(2)
                .when(x.hot || i === peak, (el) => el.child(div().text_size(10).text_color(t.muted).child(String(x.v))))
                .child(
                  div()
                    .w_full()
                    .rounded(2)
                    .bg(x.future ? t.border : t.accent)
                    .opacity(x.hot ? 1 : 0.55)
                    .h(Math.max(x.v ? 3 : 1, Math.round(((height - 16) * x.v) / max))),
                ),
            ),
          ),
      )
      .child(
        h_flex()
          .gap(4)
          .children(items.map((x, i) => div().flex_1().text_size(9.5).text_color(t.dim).child(labelOf(x, i)))),
      );
  }

  body(t, s) {
    const out = [];
    out.push(
      h_flex()
        .gap(8)
        .child(this.tile(t, "Merged this week", s.merged_this_week, "last week", delta(t, s.merged_this_week, s.merged_last_week)))
        .child(this.tile(t, "Merged · 30 days", s.merged_30d, "prior 30 days", delta(t, s.merged_30d, s.merged_prev_30d))),
    );
    out.push(
      h_flex()
        .gap(8)
        .child(this.tile(t, "Time to merge", hours(s.median_hours_to_merge), "median · 30 days"))
        .child(this.tile(t, "Open PRs", s.open, s.open ? `oldest ${s.oldest_open_days}d` : "none open")),
    );

    const ai = s.ai_marked ?? {};
    const total = Object.values(ai).reduce((a, b) => a + b, 0);
    const parts = [
      ["Claude", ai.claude ?? 0, AI_COLORS.claude],
      ["Codex", ai.codex ?? 0, AI_COLORS.codex],
      ["Both", ai.both ?? 0, AI_COLORS.both],
      ["No AI mark", ai.none ?? 0, t.border],
    ];
    out.push(
      this.card(t, "AI share", null, [
        h_flex()
          .gap(6)
          .items_baseline()
          .child(div().text_size(22).font_semibold().child(`${s.ai_share_percent ?? 0}%`))
          .child(div().text_size(11).text_color(t.muted).child(`of ${n(total)} merged PRs made with AI`)),
        h_flex()
          .h(8)
          .rounded(4)
          .overflow_hidden()
          .children(parts.filter((p) => p[1]).map(([, v, c], i) => div().id(`ai-${i}`).h_full().flex_grow(v).bg(c))),
        h_flex()
          .gap(10)
          .flex_wrap()
          .children(
            parts.map(([label, v, c], i) =>
              h_flex().id(`al-${i}`).gap(4).items_center().child(div().w(8).h(8).rounded(4).bg(c)).child(div().text_size(10.5).text_color(t.muted).child(`${label} ${v}`)),
            ),
          ),
        div()
          .text_size(10.5)
          .text_color(t.dim)
          .child(`${n(s.with_agent_sessions)} had agent sessions on their branch · ${money(s.cost_per_pr_usd)} each`),
      ]),
    );

    const weeks = (s.weeks ?? []).map((w, i, all) => ({ v: w.merged, hot: i === all.length - 1, start: w.start }));
    out.push(
      this.card(t, "PRs merged per week", "all your repos · releases to main not counted", [
        this.bars(t, "wk", weeks, 110, (x, i) => (i === weeks.length - 1 ? "now" : i % 3 === 0 ? monthDay(x.start) : "")),
      ]),
    );
    const today = new Date().toISOString().slice(0, 10);
    const days = (s.this_week ?? []).map((d) => ({ v: d.merged, hot: d.date === today, future: d.future, date: d.date }));
    out.push(
      this.card(t, "This week, day by day", "PRs merged · your local time", [
        this.bars(t, "day", days, 70, (x) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][days.indexOf(x)]),
      ]),
    );

    const repos = s.by_repo ?? [];
    const top = repos.slice(0, 5);
    const rest = repos.slice(5);
    const max = Math.max(1, ...top.map((r) => r.merged));
    out.push(
      this.card(t, "By repo", "PRs merged, last 30 days", [
        ...top.map((r, i) =>
          v_flex()
            .id(`repo-${i}`)
            .gap(2)
            .child(
              h_flex()
                .justify_between()
                .text_size(11.5)
                .child(div().truncate().child(r.repo.split("/").pop()))
                .child(div().text_color(t.muted).child(`${r.merged} · ${n(r.commits)} commits`)),
            )
            .child(div().h(4).rounded(2).bg(t.border).child(div().h_full().rounded(2).bg(t.accent).w(Math.round((260 * r.merged) / max)))),
        ),
        ...(rest.length
          ? [div().text_size(10.5).text_color(t.dim).child(`${rest.length} more repo${rest.length === 1 ? "" : "s"} · ${rest.reduce((a, r) => a + r.merged, 0)} PRs`)]
          : []),
        ...(repos.length ? [] : [div().text_size(11).text_color(t.dim).child("No merged PRs in the last 30 days.")]),
      ]),
    );

    const line = (label, value, hint) =>
      h_flex()
        .justify_between()
        .items_baseline()
        .child(div().text_size(11.5).text_color(t.muted).child(label))
        .child(h_flex().gap(6).items_baseline().child(div().text_size(12.5).font_semibold().child(value)).child(div().text_size(10.5).text_color(t.dim).child(hint)));
    out.push(
      this.card(t, "Last 30 days", null, [
        line("Your commits", n(s.commits_30d), `${repos.length} repos`),
        line("Reviews of others' PRs", n(s.reviews_30d), `prior 30: ${n(s.reviews_prev_30d)}`),
        line("Merge rate", s.merge_rate_90d == null ? "—" : `${s.merge_rate_90d}%`, `${n(s.decided_90d)} decided · 90 days`),
      ]),
    );
    return out;
  }

  render() {
    const t = theme();
    const c = shared(KEY);
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.surface)
      .border_1()
      .border_color(t.border)
      .rounded(8)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(42)
          .flex_none()
          .px(12)
          .gap(8)
          .items_center()
          .child(div().text_size(13).font_semibold().child("Your stats"))
          .child(div().flex_1().text_size(11).text_color(t.dim).child(this.loading ? "Loading…" : ago(c?.at)))
          .child(
            div()
              .id("refresh")
              .cursor_pointer()
              .px(8)
              .rounded(4)
              .text_size(11.5)
              .bg(t.raised)
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => cx.spawn((cx) => this.maybeLoad(cx, true)))
              .child(this.loading ? "…" : "Refresh"),
          ),
      )
      .child(
        v_flex()
          .id("body")
          .flex_1()
          .min_h(0)
          .px(10)
          .pb(10)
          .gap(8)
          .overflow_y_scrollbar()
          .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
          .when(!c?.s && this.loading, (el) =>
            el.child(div().text_size(12).text_color(t.dim).child("Loading your numbers… the first load takes about 15 seconds.")),
          )
          .when(Boolean(c?.s), (el) => el.children(this.body(t, c.s))),
      );
  }
}
