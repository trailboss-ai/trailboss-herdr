import { div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState } from "gpui-base";
import { exec, theme, settings, home, readTextFile, shared, setShared, closeOverlay } from "herdr";
import { tb, err, findBin, compact, duration, longDate, monthDay, money, plural, short } from "./lib.js";

// Usage insights, as a window (what the insights mod did): lifetime numbers and streaks, a
// year heatmap, a token breakdown for any day, weekly top models and a model leaderboard
// against the previous period, with periods and filters; and settings for the view, the
// sources trailboss reads, and the config itself. Ported in shape from the insights mod
// (MIT, Gagan Devagiri; see THIRD_PARTY_NOTICES.md), which also made the logos.

const PREFS = "trailboss.insights.prefs";
const DEFAULTS = { palette: "blue", weekStart: 0, includeCache: true, refreshSeconds: 60, mode: "daily" };
const prefs = () => ({ ...DEFAULTS, ...(shared(PREFS) ?? {}) });
const setPref = (k, v) => setShared(PREFS, { ...prefs(), [k]: v });

const PERIODS = [["week", "Week"], ["month", "Month"], ["year", "Year"], ["all", "All"]];
const MODES = [["daily", "Daily"], ["weekly", "Weekly"], ["cumulative", "Cumulative"]];
const CHART = ["#5b8def", "#3fb27f", "#e0a23c", "#d96c92", "#8f6fe0", "#41b3ba", "#e2704f"];
const OTHER = "#6f8fd1";
const PALETTES = {
  blue: { light: ["#ebedf0", "#c6dbef", "#6baed6", "#2171b5", "#08306b"], dark: ["#1c2129", "#0c2d6b", "#1f6feb", "#58a6ff", "#a5d6ff"] },
  green: { light: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"], dark: ["#1c2129", "#0e4429", "#006d32", "#26a641", "#39d353"] },
  purple: { light: ["#ebedf0", "#d8c4f2", "#b18be0", "#8a55c9", "#5e2a9e"], dark: ["#1c2129", "#3b2266", "#5f3aa3", "#8a63d2", "#c0a4f5"] },
};

const PROVIDER_LOGOS = {
  openai: "openai", anthropic: "anthropic", google: "googlegemini", gemini: "googlegemini", deepseek: "deepseek",
  xai: "xai", meta: "meta", mistral: "mistralai", aws: "amazonaws", amazon: "amazonaws", bedrock: "amazonaws",
  opencode: "opencode", ollama: "ollama",
};
const MODEL_LOGOS = [
  [/claude/i, "anthropic"], [/gpt|\bo[1-9]/i, "openai"], [/gemini/i, "googlegemini"], [/deepseek/i, "deepseek"],
  [/grok/i, "xai"], [/mistral|mixtral|codestral/i, "mistralai"], [/ollama/i, "ollama"], [/llama/i, "meta"],
];
function logo(model, provider) {
  const m = String(model ?? "").toLowerCase();
  const byModel = MODEL_LOGOS.find(([re]) => re.test(m.split("/").pop()) || re.test(m))?.[1];
  const p = String(provider ?? "").toLowerCase();
  const byProvider = PROVIDER_LOGOS[p] ?? Object.entries(PROVIDER_LOGOS).find(([k]) => p.startsWith(k))?.[1];
  return byModel ?? byProvider ?? null;
}

// Dark or light from the theme's background, for the heatmap palette.
function isDark(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex ?? "");
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

const addDays = (day, k) => {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(y, m - 1, d + k);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export class Insights {
  init(p, cx) {
    this.overlay = p.overlay;
    this.data = null;
    this.scan = null;
    this.error = null;
    this.loading = false;
    this.progress = null;
    this.settingsOpen = false;
    this.menu = null; // "provider" | "model"
    this.opts = { period: "all", year: null, provider: null, model: null, day: null };
    this.width = 1000;
    this.message = null;
    this.config = null;
    this.refreshInput = InputState.new({ placeholder: "60" });
    this.refreshInput.on("submit", (_e, cx) => {
      const v = Math.round(Number(this.refreshInput.value()));
      if (v >= 30 && v <= 3600) {
        setPref("refreshSeconds", v);
        this.arm(cx);
      } else this.message = "Refresh interval: 30 to 3600 seconds.";
      cx.notify();
    });
    this.rootInputs = {};
    cx.spawn((cx) => this.load(cx, true));
    this.arm(cx);
  }

  // Refresh on the chosen interval; re-armed when it changes.
  arm(cx) {
    const every = prefs().refreshSeconds * 1000;
    if (this.armed === every) return;
    this.armed = every;
    const gen = (this.gen = (this.gen ?? 0) + 1);
    cx.timer.every(every, (cx) => {
      if (gen === this.gen) cx.spawn((cx) => this.load(cx, false));
    });
  }

  args() {
    const o = this.opts, p = prefs();
    const a = ["insights", "--period", o.period];
    if (o.period === "year" && o.year) a.push("--year", String(o.year));
    if (o.provider) a.push("--provider", o.provider);
    if (o.model) a.push("--model", o.model);
    if (o.day) a.push("--day", o.day);
    if (!p.includeCache) a.push("--no-cache");
    if (p.weekStart === 1) a.push("--monday");
    return a;
  }

  async load(cx, withScan) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    // Every trailboss command indexes what's new first; show how far a long scan is.
    const progressFile = `${home()}/.local/share/trailboss/scan-progress.json`;
    let watching = true;
    cx.spawn(async (cx) => {
      for (let i = 0; watching && i < 240; i++) {
        try {
          const text = await readTextFile(progressFile);
          this.progress = text ? JSON.parse(text) : null;
          cx.notify();
        } catch {}
        await new Promise((r) => cx.timer.after(500, () => r()));
      }
    });
    try {
      this.data = await tb(this.args());
      if (withScan || this.settingsOpen) {
        this.scan = await tb(["scan"]);
        this.makeRootInputs();
      }
      this.error = null;
      this.updated = Date.now();
    } catch (e) {
      this.error = err(e);
    } finally {
      watching = false;
      this.progress = null;
      this.loading = false;
    }
    cx.notify();
  }

  set(cx, change) {
    Object.assign(this.opts, change);
    this.menu = null;
    cx.spawn((cx) => this.load(cx, false));
    cx.notify();
  }

  // ---------------------------------------------------------------- pieces

  button(t, id, label, onClick, active) {
    return div()
      .id(id)
      .cursor_pointer()
      .px(10)
      .py(3)
      .rounded(6)
      .text_size(12)
      .bg(active ? t.selected : t.raised)
      .text_color(active ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover))
      .on_click(onClick)
      .child(label);
  }

  segmented(t, id, items, value, onPick) {
    return h_flex()
      .p(2)
      .gap(2)
      .rounded(7)
      .bg(t.raised)
      .children(
        items.map(([v, label]) =>
          div()
            .id(`${id}-${v}`)
            .cursor_pointer()
            .px(10)
            .py(2)
            .rounded(5)
            .text_size(11.5)
            .bg(value === v ? t.background : t.raised)
            .text_color(value === v ? t.foreground : t.muted)
            .on_click((_e, cx) => onPick(v, cx))
            .child(label),
        ),
      );
  }

  card(t, title, sub, children, right) {
    return v_flex()
      .gap(10)
      .p(14)
      .rounded(10)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().text_size(13).font_semibold().child(title))
          .when(Boolean(sub), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(sub)))
          .child(div().flex_1())
          .when(Boolean(right), (el) => el.child(right)),
      )
      .children(children);
  }

  section(t, title) {
    return h_flex()
      .gap(10)
      .items_center()
      .pt(6)
      .child(div().text_size(12).font_semibold().text_color(t.muted).child(title))
      .child(div().flex_1().h(1).bg(t.border));
  }

  logoTile(t, model, provider) {
    const l = logo(model, provider);
    return div()
      .w(22)
      .h(22)
      .flex_none()
      .rounded(5)
      .bg(t.raised)
      .flex()
      .items_center()
      .justify_center()
      .child(l ? image(`mods/trailboss/logos/${l}.svg`).w(14).h(14) : div().text_size(11).text_color(t.muted).child(String(model ?? "?")[0].toUpperCase()));
  }

  // ---------------------------------------------------------------- dashboard

  metrics(t, d) {
    const m = d.metrics;
    const stats = [
      ["Lifetime tokens", compact(m.lifetime_tokens), `${plural(m.lifetime_sessions, "session")} · all time`],
      ["Peak day", m.peak_day ? compact(m.peak_day.tokens) : "—", m.peak_day ? longDate(m.peak_day.date) : "No activity yet"],
      ["Longest task", duration(m.longest_task_ms), m.longest_task_ms == null ? "Not reported" : "Observed span"],
      ["Longest streak", `${m.longest_streak_days}D`, "consecutive days"],
      ["Current streak", `${m.current_streak_days}D`, m.current_streak_days ? "keep it going" : "no activity today or yesterday"],
      ["API-equivalent cost", money(m.lifetime_cost_usd), "all time, at list prices"],
    ];
    const per = this.width >= 920 ? 6 : this.width >= 600 ? 3 : 2;
    const rows = [];
    for (let i = 0; i < stats.length; i += per) rows.push(stats.slice(i, i + per));
    return v_flex()
      .gap(8)
      .children(
        rows.map((row, r) =>
          h_flex()
            .id(`mrow-${r}`)
            .gap(8)
            .children(
              row.map(([label, value, note], i) =>
                v_flex()
                  .id(`metric-${r}-${i}`)
                  .flex_1()
                  .min_w(0)
                  .gap(2)
                  .p(12)
                  .rounded(10)
                  .bg(t.background)
                  .border_1()
                  .border_color(t.border)
                  .child(div().text_size(11).text_color(t.dim).child(label))
                  .child(div().text_size(22).font_semibold().text_color(label === "Current streak" && m.current_streak_days ? t.accent : t.foreground).child(value))
                  .child(div().truncate().text_size(11).text_color(t.muted).child(note)),
              ),
            ),
        ),
      );
  }

  heatmap(t, d) {
    const p = prefs();
    const h = d.heatmap;
    const colors = PALETTES[p.palette]?.[isDark(t.background) ? "dark" : "light"] ?? PALETTES.blue.dark;
    const days = h.tokens.length;
    const today = d.today;
    // Values per mode: the day, its week's total, or the running total.
    const vals = h.tokens.slice();
    if (p.mode === "weekly") {
      for (let w = 0; w < days; w += 7) {
        const sum = h.tokens.slice(w, w + 7).reduce((a, b) => a + b, 0);
        for (let k = w; k < Math.min(w + 7, days); k++) vals[k] = sum;
      }
    } else if (p.mode === "cumulative") {
      let run = h.before;
      for (let k = 0; k < days; k++) vals[k] = run += h.tokens[k];
    }
    const max = Math.max(1, ...vals);
    const lvl = (v) => (v <= 0 ? 0 : Math.min(4, Math.ceil((4 * v) / max)));
    const cell = Math.max(12, Math.min(20, Math.floor((this.width - 160) / 53) - 2));
    const selected = d.totals.day.date;
    const cols = [];
    for (let w = 0; w < 53; w++) {
      const col = [];
      for (let k = 0; k < 7; k++) {
        const i = w * 7 + k;
        const day = addDays(h.start, i);
        const future = i >= days;
        col.push(
          div()
            .id(`c-${i}`)
            .w(cell)
            .h(cell)
            .rounded(3)
            .bg(future ? colors[0] : colors[lvl(vals[i])])
            .opacity(future ? 0.3 : 1)
            .when(day === selected, (el) => el.border_2().border_color(t.foreground))
            .when(!future, (el) =>
              el
                .cursor_pointer()
                .hover((s) => s.opacity(0.8))
                .on_click((_e, cx) => this.set(cx, { day: day === today ? null : day })),
            ),
        );
      }
      cols.push(v_flex().id(`col-${w}`).gap(2).children(col));
    }
    // A month's name over its first week, when the month spans at least two weeks.
    const months = [];
    for (let w = 0; w < 53; w++) {
      const first = addDays(h.start, w * 7);
      const prev = w ? addDays(h.start, w * 7 - 7) : null;
      const isNew = !prev || first.slice(5, 7) !== prev.slice(5, 7);
      const next = addDays(h.start, w * 7 + 7);
      const spans = next.slice(5, 7) === first.slice(5, 7);
      months.push(
        div()
          .id(`mo-${w}`)
          .w(cell)
          .text_size(10)
          .text_color(t.dim)
          .child(isNew && spans ? new Date(`${first}T00:00:00`).toLocaleDateString("en", { month: "short" }) : ""),
      );
    }
    const names = p.weekStart === 1 ? ["Mon", "", "Wed", "", "Fri", "", "Sun"] : ["Sun", "", "Tue", "", "Thu", "", "Sat"];
    const windowTotal = h.tokens.reduce((a, b) => a + b, 0);
    return this.card(
      t,
      "Tokens History",
      null,
      [
        h_flex()
          .gap(6)
          .justify_center()
          .overflow_x_scrollbar()
          .child(v_flex().gap(2).pt(16).children(names.map((n, i) => div().id(`wd-${i}`).h(cell).text_size(10).text_color(t.dim).child(n))))
          .child(v_flex().gap(2).child(h_flex().gap(2).h(14).children(months)).child(h_flex().gap(2).children(cols))),
        h_flex()
          .gap(4)
          .items_center()
          .justify_end()
          .text_size(10.5)
          .text_color(t.dim)
          .child("Less")
          .children(colors.map((c, i) => div().id(`lg-${i}`).w(10).h(10).rounded(2).bg(c)))
          .child("More")
          .child(div().pl(10).child(`${compact(windowTotal)} in window`)),
      ],
      this.segmented(t, "mode", MODES, p.mode, (v, cx) => {
        setPref("mode", v);
        cx.notify();
      }),
    );
  }

  detail(t, d) {
    const col = (title, x) =>
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(6)
        .child(div().text_size(12).font_semibold().child(title))
        .children(
          [
            ["Input", compact(x.input)],
            ["Output", `${compact(x.output)}${x.reasoning ? ` (${compact(x.reasoning)} reasoning)` : ""}`],
            ["Cache hit rate", x.cache_hit_rate == null ? "—" : `${x.cache_hit_rate}%`],
            ["Top model", x.top_model?.model ? `${x.top_model.model} · ${x.top_model.provider}` : "No model usage"],
            ["Cost", money(x.cost_usd)],
          ].map(([k, v], i) =>
            h_flex()
              .id(`${title}-${i}`)
              .justify_between()
              .gap(8)
              .text_size(12)
              .child(div().text_color(t.muted).child(k))
              .child(div().truncate().child(v)),
          ),
        );
    const day = d.totals.day.date;
    return this.card(t, "Token detail", null, [
      h_flex()
        .gap(24)
        .child(col("All time", d.totals.all))
        .child(col(day === d.today ? "Today" : longDate(day), d.totals.day)),
    ]);
  }

  filterMenu(t, kind) {
    const f = this.data.filters;
    const opts = kind === "provider" ? f.providers : f.models;
    const value = this.opts[kind];
    return v_flex()
      .id(`menu-${kind}`)
      .gap(1)
      .p(6)
      .rounded(8)
      .bg(t.popover)
      .border_1()
      .border_color(t.border)
      .max_h(260)
      .overflow_y_scrollbar()
      .child(
        h_flex()
          .id(`${kind}-all`)
          .cursor_pointer()
          .px(8)
          .py(3)
          .rounded(4)
          .gap(8)
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.set(cx, { [kind]: null }))
          .child(div().w(12).text_color(t.accent).child(value ? "" : "✓"))
          .child(div().text_size(12).child(kind === "provider" ? "All providers" : "All models")),
      )
      .children(
        opts.map((o, i) =>
          h_flex()
            .id(`${kind}-${i}`)
            .cursor_pointer()
            .px(8)
            .py(3)
            .rounded(4)
            .gap(8)
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.set(cx, { [kind]: o.value }))
            .child(div().w(12).text_color(t.accent).child(value === o.value ? "✓" : ""))
            .child(div().flex_1().truncate().text_size(12).child(o.value))
            .child(div().text_size(11).text_color(t.dim).child(`${compact(o.tokens)} · ${plural(o.sessions, "session")}`)),
        ),
      )
      .when(opts.length >= 250, (el) => el.child(div().px(8).text_size(10.5).text_color(t.dim).child("Showing top 250 by tokens.")));
  }

  filters(t, d) {
    const o = this.opts;
    const trigger = (kind, label) =>
      div()
        .id(`trig-${kind}`)
        .cursor_pointer()
        .px(10)
        .py(3)
        .rounded(6)
        .text_size(12)
        .bg(t.raised)
        .border_1()
        .border_color(o[kind] ? t.accent : t.raised)
        .text_color(o[kind] ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.menu = this.menu === kind ? null : kind;
          cx.notify();
        })
        .child(`${label} ${short(o[kind] ?? "All", 24)} ⌄`);
    const year = d.year;
    return v_flex()
      .gap(6)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .flex_wrap()
          .child(this.segmented(t, "period", PERIODS, o.period, (v, cx) => this.set(cx, { period: v, year: null, day: null })))
          .when(o.period === "year", (el) =>
            el.child(
              h_flex()
                .gap(6)
                .items_center()
                .child(
                  div()
                    .id("older")
                    .cursor_pointer()
                    .px(6)
                    .text_color(d.years.includes(year - 1) ? t.foreground : t.dim)
                    .on_click((_e, cx) => d.years.includes(year - 1) && this.set(cx, { year: year - 1, day: null }))
                    .child("‹"),
                )
                .child(div().text_size(12.5).font_semibold().child(String(year)))
                .child(
                  div()
                    .id("newer")
                    .cursor_pointer()
                    .px(6)
                    .text_color(d.years.includes(year + 1) ? t.foreground : t.dim)
                    .on_click((_e, cx) => d.years.includes(year + 1) && this.set(cx, { year: year + 1, day: null }))
                    .child("›"),
                ),
            ),
          )
          .child(trigger("provider", "Provider"))
          .child(trigger("model", "Model"))
          .when(Boolean(o.provider || o.model), (el) =>
            el.child(
              div()
                .id("clear")
                .cursor_pointer()
                .px(8)
                .text_size(12)
                .text_color(t.muted)
                .hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => this.set(cx, { provider: null, model: null }))
                .child("Clear filters"),
            ),
          ),
      )
      .when(Boolean(this.menu), (el) => el.child(this.filterMenu(t, this.menu)));
  }

  chart(t, d) {
    const c = d.chart;
    const weeks = c.weeks;
    const total = weeks.reduce((a, w) => a + w.total, 0);
    const max = Math.max(1, ...weeks.map((w) => w.total));
    const H = 168;
    const color = (m) => (m === "Other" ? OTHER : CHART[c.models.indexOf(m) % CHART.length]);
    if (!total) return this.card(t, "Top models", null, [div().text_size(12).text_color(t.dim).child("No model usage in this window.")]);
    return this.card(t, "Top models", `${weeks.length} weeks · ${compact(total)} tokens · cache ${prefs().includeCache ? "included" : "excluded"}`, [
      h_flex()
        .gap(8)
        .child(
          v_flex()
            .h(H)
            .justify_between()
            .text_size(10)
            .text_color(t.dim)
            .child(compact(max))
            .child(compact(max / 2))
            .child("0"),
        )
        .child(
          h_flex()
            .flex_1()
            .h(H)
            .gap(3)
            .items_end()
            .children(
              weeks.map((w, i) =>
                v_flex()
                  .id(`bar-${i}`)
                  .flex_1()
                  .justify_end()
                  .h(Math.round((H * w.total) / max))
                  .children(
                    [...c.models]
                      .reverse()
                      .filter((m) => w.parts[m])
                      .map((m, k) => div().id(`seg-${i}-${k}`).w_full().bg(color(m)).h(Math.max(1, Math.round((H * w.parts[m]) / max)))),
                  ),
              ),
            ),
        ),
      h_flex()
        .pl(40)
        .gap(3)
        .children(weeks.map((w, i) => div().id(`xl-${i}`).flex_1().text_size(9.5).text_color(t.dim).child(i % Math.ceil(weeks.length / 6) === 0 ? monthDay(w.start) : ""))),
      h_flex()
        .gap(12)
        .flex_wrap()
        .children(
          c.models.map((m, i) =>
            h_flex().id(`leg-${i}`).gap(5).items_center().child(div().w(8).h(8).rounded(4).bg(color(m))).child(div().text_size(11).text_color(t.muted).child(m)),
          ),
        ),
    ]);
  }

  leaderboard(t, d) {
    const lb = d.leaderboard;
    const range =
      d.period === "all" ? "All time" : d.period === "year" ? String(d.year) : `${longDate(d.from)} – ${d.to === d.today ? "today" : longDate(d.to)}`;
    const change = (r) => {
      const c = r.change_percent;
      if (c == null) return [t.dim, "—"];
      if (c === "new") return [t.accent, "New"];
      if (c === 0) return [t.dim, "0%"];
      return c > 0 ? [t.done, `↑+${c}%`] : [t.blocked, `↓${c}%`];
    };
    const rows = lb.rows.map((r, i) => {
      const [col, text] = change(r);
      return h_flex()
        .id(`lb-${i}`)
        .gap(10)
        .py(5)
        .items_center()
        .text_size(12)
        .child(div().w(22).text_color(t.dim).child(`${r.rank}.`))
        .child(this.logoTile(t, r.model, r.provider))
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .child(div().truncate().child(r.model))
            .child(div().text_size(10.5).text_color(t.dim).child(`by ${r.provider}${r.other_providers ? ` +${r.other_providers}` : ""}`)),
        )
        .child(div().w(70).text_color(t.muted).child(money(r.cost_usd)))
        .child(div().w(90).child(`${compact(r.tokens)} tokens`))
        .child(div().w(70).text_color(col).child(text));
    });
    if (!lb.rows.length)
      return this.card(t, "Model Usage", range, [
        div().text_size(12.5).child("No usage in this period"),
        div().text_size(11.5).text_color(t.dim).child("Try All time, another year, or clear the filters."),
        h_flex().child(this.button(t, "show-all", "Show all time", (_e, cx) => this.set(cx, { period: "all", provider: null, model: null }))),
      ]);
    return this.card(t, "Model Usage", `${range} · ${compact(lb.tokens)} tokens · ${plural(lb.sessions, "session")}`, [
      ...rows,
      ...(lb.count > lb.rows.length ? [div().text_size(11).text_color(t.dim).child(`Showing top ${lb.rows.length} of ${lb.count} by tokens.`)] : []),
    ]);
  }

  dashboard(t, d) {
    const out = [this.metrics(t, d)];
    if (!d.metrics.lifetime_tokens) {
      out.push(
        this.card(t, "No usage found yet", null, [
          div().text_size(12).text_color(t.muted).child("Trailboss reads Claude Code, Codex, opencode and pi sessions, plus any sources you add."),
          h_flex().child(this.button(t, "open-settings", "Open settings", (_e, cx) => this.toggleSettings(cx))),
        ]),
      );
    }
    out.push(this.section(t, "Token usage"), this.heatmap(t, d), this.detail(t, d));
    out.push(this.section(t, "Model usage"), this.filters(t, d), this.chart(t, d), this.leaderboard(t, d));
    return out;
  }

  // ---------------------------------------------------------------- settings

  toggleSettings(cx) {
    this.settingsOpen = !this.settingsOpen;
    if (this.settingsOpen) {
      cx.spawn(async (cx) => {
        try {
          this.scan = await tb(["scan"]);
          this.makeRootInputs();
          const r = await exec(await findBin(), ["config"]);
          this.config = EditorState.new({
            language: "json",
            value: r.stdout || "{}\n",
            font_family: settings().font_family,
            syntax: { string: theme().ansi2, number: theme().ansi3, boolean: theme().ansi5, keyword: theme().ansi5, punctuation: theme().muted },
          });
        } catch (e) {
          this.message = err(e);
        }
        cx.notify();
      });
    }
    cx.notify();
  }

  async saveConfig(cx, text) {
    try {
      const r = await exec(await findBin(), ["config", "--set", text]);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
      this.config?.set_value(r.stdout);
      this.message = "Configuration saved.";
      await this.load(cx, true);
    } catch (e) {
      this.message = err(e);
    }
    cx.notify();
  }

  // One folders input per source (comma or newline separated; Enter saves). Made here, in a
  // handler, because input state can't be created while rendering.
  makeRootInputs() {
    for (const s of this.scan ?? []) {
      if (this.rootInputs[s.source]) continue;
      const st = InputState.new({ placeholder: "~/.agent/sessions", value: (s.roots ?? []).join(", ") });
      st.on("submit", (_e, cx) =>
        cx.spawn((cx) => this.editSource(cx, s.source, { roots: st.value().split(/[,\n]/).map((x) => x.trim()).filter(Boolean) })),
      );
      this.rootInputs[s.source] = st;
    }
  }

  // Change one source's setting in the config, then save it.
  async editSource(cx, name, change) {
    let cfg = {};
    try {
      cfg = JSON.parse(this.config?.value() || "{}");
    } catch {
      this.message = "Fix the configuration JSON first.";
      cx.notify();
      return;
    }
    cfg.sources = cfg.sources ?? {};
    cfg.sources[name] = { ...(cfg.sources[name] ?? {}), ...change };
    await this.saveConfig(cx, JSON.stringify(cfg));
  }

  settingsView(t) {
    const p = prefs();
    const out = [];
    out.push(
      this.card(t, "Preferences", null, [
        h_flex().justify_between().items_center().child(div().text_size(12).child("Heatmap palette")).child(
          this.segmented(t, "palette", [["blue", "Blue"], ["green", "Green"], ["purple", "Purple"]], p.palette, (v, cx) => {
            setPref("palette", v);
            cx.notify();
          }),
        ),
        h_flex().justify_between().items_center().child(div().text_size(12).child("Week starts on")).child(
          this.segmented(t, "week", [[0, "Sunday"], [1, "Monday"]], p.weekStart, (v, cx) => {
            setPref("weekStart", v);
            cx.spawn((cx) => this.load(cx, false));
          }),
        ),
        h_flex().justify_between().items_center().child(div().text_size(12).child("Include cache tokens")).child(
          this.segmented(t, "cache", [[true, "On"], [false, "Off"]], p.includeCache, (v, cx) => {
            setPref("includeCache", v);
            cx.spawn((cx) => this.load(cx, false));
          }),
        ),
        h_flex()
          .justify_between()
          .items_center()
          .child(div().text_size(12).child(`Refresh interval (now ${p.refreshSeconds} sec; Enter to set)`))
          .child(Input.new(this.refreshInput).w(90).h(26).px(8).rounded(6).border_1().border_color(t.input).bg(t.surface).text_size(12)),
      ]),
    );

    const rows = this.scan ?? [];
    const dot = { ok: t.done, error: t.blocked, missing: t.dim, empty: t.idle, disabled: t.dim };
    out.push(
      this.card(
        t,
        "Sources",
        "what trailboss reads; changes save to ~/.config/trailboss/config.json",
        rows.length
          ? rows.map((s, i) => {
              const inp = this.rootInputs[s.source];
              return v_flex()
                .id(`src-${i}`)
                .gap(4)
                .p(8)
                .rounded(8)
                .bg(t.surface)
                .child(
                  h_flex()
                    .gap(8)
                    .items_center()
                    .child(
                      div()
                        .id(`en-${i}`)
                        .cursor_pointer()
                        .text_color(s.enabled ? t.accent : t.dim)
                        .on_click((_e, cx) => cx.spawn((cx) => this.editSource(cx, s.source, { enabled: !s.enabled })))
                        .child(s.enabled ? "☑" : "☐"),
                    )
                    .child(div().text_size(12.5).font_semibold().child(s.label))
                    .child(div().w(8).h(8).rounded(4).bg(dot[s.status] ?? t.dim))
                    .child(div().text_size(11).text_color(t.muted).child(s.status))
                    .child(div().flex_1())
                    .child(div().text_size(11).text_color(t.dim).child(`${s.files} files · ${s.read} read · ${s.errors} errors · ${compact(s.bytes)}B`)),
                )
                .child(
                  inp
                    ? Input.new(inp).h(26).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(11.5)
                    : div().text_size(11.5).text_color(t.dim).child((s.roots ?? []).join(", ")),
                );
            })
          : [div().text_size(12).text_color(t.dim).child("Loading sources…")],
      ),
    );

    const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
    const warnings = rows.flatMap((r) => (r.warnings ?? []).map((w) => `${r.source}: ${w}`));
    out.push(
      this.card(t, "Scan status", this.updated ? `last scan ${new Date(this.updated).toLocaleTimeString()}` : null, [
        h_flex()
          .gap(16)
          .text_size(12)
          .child(`Files ${sum("files").toLocaleString("en")}`)
          .child(`Read ${sum("read").toLocaleString("en")}`)
          .child(`Unchanged ${sum("unchanged").toLocaleString("en")}`)
          .child(`Bytes ${compact(sum("bytes"))}`)
          .child(div().text_color(sum("errors") ? t.blocked : t.done).child(sum("errors") ? plural(sum("errors"), "error") : "No scan errors")),
        ...(warnings.length
          ? [
              ...warnings.slice(0, 6).map((w, i) => div().id(`warn-${i}`).text_size(11).text_color(t.muted).child(short(w, 200))),
              ...(warnings.length > 6 ? [div().text_size(11).text_color(t.dim).child(`+${warnings.length - 6} more warnings`)] : []),
            ]
          : [div().text_size(11).text_color(t.dim).child("No scan warnings.")]),
      ]),
    );

    out.push(
      this.card(t, "Configuration", "~/.config/trailboss/config.json: sources, custom sources (see src/custom.rs), GitHub logins", [
        this.config ? div().h(320).child(Editor.new(this.config)) : div().text_size(12).text_color(t.dim).child("Loading…"),
        h_flex()
          .gap(8)
          .items_center()
          .child(
            this.button(t, "format", "Format", (_e, cx) => {
              try {
                this.config.set_value(`${JSON.stringify(JSON.parse(this.config.value()), null, 2)}\n`);
                this.message = "Formatted.";
              } catch (e) {
                this.message = `Not valid JSON: ${err(e)}`;
              }
              cx.notify();
            }),
          )
          .child(
            this.button(t, "reset", "Reset", (_e, cx) => {
              this.config = null;
              this.settingsOpen = false;
              this.toggleSettings(cx);
              this.message = "Reset to the saved configuration.";
            }),
          )
          .child(this.button(t, "save", "Save configuration", (_e, cx) => cx.spawn((cx) => this.saveConfig(cx, this.config.value()))))
          .when(Boolean(this.message), (el) => el.child(div().text_size(11.5).text_color(this.message?.endsWith(".") ? t.muted : t.blocked).child(this.message))),
      ]),
    );
    return out;
  }

  // ---------------------------------------------------------------- frame

  status() {
    if (this.loading && this.progress) return `Scanning ${this.progress.done} of ${this.progress.total} files`;
    if (this.loading) return "Refreshing…";
    if (this.error && this.data) return "Showing last snapshot";
    if (this.error) return "Unavailable";
    if (!this.updated) return "";
    const d = new Date(this.updated);
    return `Updated today ${d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}`;
  }

  render() {
    const t = theme();
    const pad = this.width < 620 ? 12 : this.width < 900 ? 16 : 24;
    const body = [];
    if (this.error) {
      body.push(
        h_flex()
          .gap(10)
          .items_center()
          .p(10)
          .rounded(8)
          .bg(t.background)
          .border_1()
          .border_color(t.blocked)
          .child(div().flex_1().text_size(12).text_color(t.blocked).child(`Could not refresh insights: ${this.error}`))
          .child(this.button(t, "retry", "Retry", (_e, cx) => cx.spawn((cx) => this.load(cx, true)))),
      );
    }
    if (this.settingsOpen) body.push(...this.settingsView(t));
    else if (this.data) body.push(...this.dashboard(t, this.data));
    else if (!this.error)
      body.push(
        this.card(t, "Loading local insights", null, [
          div()
            .text_size(12)
            .text_color(t.muted)
            .child(this.progress ? `Scanning ${this.progress.done} of ${this.progress.total} files` : "Reading the index…"),
          ...(this.progress?.file ? [div().truncate().text_size(11).text_color(t.dim).child(this.progress.file)] : []),
        ]),
      );
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => {
        this.width = size.width;
        cx.notify();
      })
      .size_full()
      .bg(t.canvas ?? t.surface)
      .text_color(t.foreground)
      .overflow_y_scrollbar()
      .child(
        v_flex()
          .w_full()
          .max_w(1180)
          .mx_auto()
          .p(pad)
          .gap(12)
          .child(
            h_flex()
              .gap(10)
              .items_center()
              .child(div().text_size(18).font_semibold().child(this.settingsOpen ? "Settings" : "Insights"))
              .child(div().flex_1().text_size(11.5).text_color(this.error ? t.blocked : t.dim).child(this.status()))
              .child(this.button(t, "refresh", "↻ Refresh", (_e, cx) => cx.spawn((cx) => this.load(cx, true))))
              .when(Boolean(this.data), (el) =>
                el.child(this.button(t, "toggle", this.settingsOpen ? "Dashboard" : "Settings", (_e, cx) => this.toggleSettings(cx))),
              )
              // A window doesn't close with Esc, so it needs its own close button.
              .when(Boolean(this.overlay), (el) =>
                el.child(
                  div()
                    .id("close")
                    .cursor_pointer()
                    .px(8)
                    .py(1)
                    .rounded(6)
                    .text_size(15)
                    .text_color(t.muted)
                    .hover((s) => s.bg(t.hover).text_color(t.foreground))
                    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                    .on_click(() => closeOverlay(this.overlay))
                    .child("×"),
                ),
              ),
          )
          .children(body),
      );
  }
}
