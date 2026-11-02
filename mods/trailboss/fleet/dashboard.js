import { div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, openOverlay, closeOverlay, notify, run } from "herdr";
import { MOD, ICON, findBin, tb, plural, money, daysAgo, short, statusColor, MISSING } from "../lib.js";

// The dashboard (Alt+Shift+T, or click the status block): Live, Search, Usage, Quota and
// Stats, each one Trailboss command, plus a button for the Insights window.

const TABS = ["Live", "Search", "Usage", "Quota", "Stats"];

export class Dashboard {
  init(p, cx) {
    this.overlay = p.overlay;
    this.initOverlay(cx);
  }

  initOverlay(cx) {
    this.tab = props()?.tab ?? "Live";
    this.rows = {};
    this.loading = {};
    this.errors = {};
    this.input = InputState.new({ placeholder: "Search every agent's sessions…" });
    this.input.on("submit", (_e, cx) => this.load(cx, "Search"));
    cx.spawn(async (cx) => {
      this.bin = await findBin();
      if (!this.bin) this.error = MISSING;
      await this.load(cx, this.tab);
    });
    // The Live tab stays live while open.
    cx.timer.every(5000, (cx) => {
      if (this.tab === "Live") cx.spawn((cx) => this.load(cx, "Live"));
    });
  }

  async load(cx, tab) {
    if (!this.bin || this.loading[tab]) return;
    this.loading[tab] = true;
    cx.notify();
    try {
      if (tab === "Live") {
        this.rows.Live = await tb(["live"]);
        this.rows.Lost = await tb(["resume", "--dry-run"]);
      } else if (tab === "Search") {
        const words = this.input.value().trim().split(/\s+/).filter(Boolean);
        this.rows.Search = words.length ? await tb(["search", "-n", "40", ...words]) : [];
      } else if (tab === "Usage") {
        this.rows.Usage = await tb(["usage", "--by", "day", "--since", daysAgo(13)]);
        this.rows.Models = await tb(["usage", "--by", "model", "--since", daysAgo(29)]);
        this.rows.Plans = await tb(["plans"]);
      } else if (tab === "Quota") {
        this.rows.Quota = await tb(["quota"]);
      } else if (tab === "Stats") {
        this.rows.Stats = await tb(["stats"]);
        this.rows.Prs = await tb(["stats", "--prs"]);
      }
      this.errors[tab] = null;
    } catch (e) {
      this.errors[tab] = String(e?.message ?? e);
    } finally {
      this.loading[tab] = false;
    }
    cx.notify();
  }

  show(tab, cx) {
    this.tab = tab;
    if (tab === "Search") this.input.focus();
    if (!this.rows[tab]) cx.spawn((cx) => this.load(cx, tab));
    cx.notify();
  }

  // One table row: [text, width or null for the rest, color?]
  line(t, id, cells, onClick) {
    return h_flex()
      .id(id)
      .px(10)
      .py(4)
      .gap(12)
      .rounded(5)
      .text_size(12)
      .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
      .children(
        cells.map(([text, w, color], i) =>
          div()
            .id(`${id}-${i}`)
            .when(w != null, (el) => el.w(w).flex_none())
            .when(w == null, (el) => el.flex_1().min_w(0))
            .truncate()
            .text_color(color ?? t.foreground)
            .child(String(text ?? "")),
        ),
      );
  }

  head(t, cells) {
    return h_flex()
      .px(10)
      .pb(4)
      .gap(12)
      .text_size(11)
      .text_color(t.dim)
      .children(
        cells.map(([text, w], i) =>
          div()
            .id(`h-${text}-${i}`)
            .when(w != null, (el) => el.w(w).flex_none())
            .when(w == null, (el) => el.flex_1())
            .child(text),
        ),
      );
  }

  note(t, text, color) {
    return div().px(10).py(6).text_size(12).text_color(color ?? t.dim).child(text);
  }

  body(t) {
    const tab = this.tab;
    const err = this.errors[tab] ?? this.error;
    const out = [];
    if (err) out.push(this.note(t, err, t.blocked));
    if (this.loading[tab] && !this.rows[tab]) out.push(this.note(t, tab === "Stats" ? "Asking GitHub…" : "Loading…"));

    if (tab === "Live") {
      const rows = this.rows.Live ?? [];
      out.push(this.head(t, [["Where", 260], ["Status", 80], ["Cost", 70], ["Session", null]]));
      rows.forEach((r, i) =>
        out.push(
          this.line(
            t,
            `live-${i}`,
            [
              [r.where, 260],
              [r.status, 80, statusColor(t, r.status)],
              [money(r.cost_usd), 70, t.muted],
              r.shares_with?.length
                ? [`same folder as ${r.shares_with.map((w) => w.split(" ")[0]).join(", ")} · ${r.title ?? r.cwd}`, null, t.working]
                : [r.title ?? r.cwd, null, t.muted],
            ],
            r.terminal
              ? () => {
                  run("pane.focus", { terminal: r.terminal });
                  closeOverlay(this.overlay);
                }
              : null,
          ),
        ),
      );
      if (!rows.length && this.rows.Live) out.push(this.note(t, "No agents running."));
      const lost = this.rows.Lost ?? [];
      if (lost.length) {
        out.push(
          h_flex()
            .px(10)
            .pt(14)
            .pb(4)
            .gap(10)
            .items_center()
            .child(div().text_size(12).font_semibold().child(`Lost (${lost.length})`))
            .child(
              div()
                .id("resume-now")
                .cursor_pointer()
                .px(8)
                .rounded(4)
                .text_size(11.5)
                .bg(t.solid)
                .text_color(t.solid_foreground)
                .hover((s) => s.opacity(0.85))
                .on_click((_e, cx) =>
                  cx.spawn(async (cx) => {
                    const rows = await tb(["resume"]).catch((e) => {
                      notify({ title: "Resume failed", body: String(e?.message ?? e), level: "error" });
                      return [];
                    });
                    const done = rows.filter((r) => r.action === "resumed").length;
                    notify({ title: `Resumed ${plural(done, "agent session")}`, level: done ? "success" : "info" });
                    await this.load(cx, "Live");
                  }),
                )
                .child("Resume now"),
            ),
        );
        lost.forEach((r, i) =>
          out.push(this.line(t, `lost-${i}`, [[r.where, 260], [r.action, 110, t.muted], [r.detail, null, t.dim]])),
        );
      }
    }

    if (tab === "Search") {
      out.push(
        div()
          .px(10)
          .pb(8)
          .child(
            Input.new(this.input)
              .h(30)
              .px(10)
              .rounded(7)
              .border_1()
              .border_color(t.input)
              .bg(t.background)
              .text_size(12.5)
              .text_color(t.foreground),
          ),
      );
      const rows = this.rows.Search;
      if (rows && !rows.length) out.push(this.note(t, "No matches."));
      if (!rows) out.push(this.note(t, "Words in any order; press Enter. Click a result to reopen that session in a new tab."));
      (rows ?? []).forEach((r, i) =>
        out.push(
          this.line(
            t,
            `hit-${i}`,
            [
              [(r.ts ?? "").slice(0, 10), 80, t.dim],
              [r.agent, 60, t.muted],
              [short(r.title, 40), 230],
              [r.snippet, null, t.muted],
            ],
            r.resume_argv
              ? () => {
                  run("tab.new", { name: short(r.title ?? r.agent, 30), folder: r.cwd ?? undefined, argv: r.resume_argv });
                  closeOverlay(this.overlay);
                }
              : null,
          ),
        ),
      );
    }

    if (tab === "Usage") {
      const days = this.rows.Usage ?? [];
      const max = Math.max(1, ...days.map((d) => d.cost_usd ?? 0));
      out.push(this.head(t, [["Day", 90], ["API-equivalent cost", null], ["", 80], ["Tokens", 110]]));
      days.forEach((d, i) =>
        out.push(
          h_flex()
            .id(`day-${i}`)
            .px(10)
            .py(3)
            .gap(12)
            .items_center()
            .text_size(12)
            .child(div().w(90).flex_none().text_color(t.muted).child(d.key))
            .child(
              div()
                .flex_1()
                .h(10)
                .child(div().h_full().rounded(3).bg(t.accent).w(Math.max(2, Math.round((400 * (d.cost_usd ?? 0)) / max)))),
            )
            .child(div().w(80).flex_none().child(money(d.cost_usd)))
            .child(div().w(110).flex_none().text_color(t.dim).child(`${((d.total ?? 0) / 1e6).toFixed(1)}M`)),
        ),
      );
      out.push(div().px(10).pt(14).pb(4).text_size(12).font_semibold().child("Last 30 days by model"));
      out.push(this.head(t, [["Model", null], ["Cost", 90], ["Responses", 90], ["Unpriced", 80]]));
      (this.rows.Models ?? []).forEach((m, i) =>
        out.push(
          this.line(t, `model-${i}`, [
            [m.key, null],
            [money(m.cost_usd), 90],
            [m.responses, 90, t.muted],
            [m.unpriced || "", 80, m.unpriced ? t.blocked : t.dim],
          ]),
        ),
      );
      out.push(div().px(10).pt(14).pb(4).text_size(12).font_semibold().child("Plans: this billing cycle at API prices"));
      const plans = this.rows.Plans ?? [];
      if (plans.length) {
        out.push(this.head(t, [["Plan", null], ["Price", 70], ["So far", 90], ["×", 50], ["Projected", 110], ["Last cycle", 110]]));
        const x = (m) => (m == null ? "—" : `${m}×`);
        plans.forEach((p, i) =>
          out.push(
            this.line(t, `plan-${i}`, [
              [`${p.plan} (${p.agents})`, null],
              [money(p.price_usd), 70, t.muted],
              [money(p.cost_usd), 90],
              [x(p.multiple), 50, (p.multiple ?? 0) >= 1 ? t.done : t.muted],
              [`${money(p.projected_usd)} · ${x(p.projected_multiple)}`, 110, t.muted],
              [`${money(p.last_cycle_usd)} · ${x(p.last_multiple)}`, 110, t.muted],
            ]),
          ),
        );
      } else {
        out.push(this.note(t, "No plans set. Add yours: trailboss plans --add \"Claude Max\" --price 200 --agents claude [--renews 15]"));
      }
      out.push(this.note(t, "At API list prices: what this usage would cost per token, not what your plan charges."));
    }

    if (tab === "Quota") {
      out.push(this.head(t, [["Provider", 90], ["Plan", 80], ["Window", 80], ["Used", 60], ["Resets in", 90], ["Pace", 80], ["", null]]));
      (this.rows.Quota ?? []).forEach((q, i) =>
        out.push(
          this.line(t, `quota-${i}`, [
            [q.provider, 90],
            [q.plan, 80, t.muted],
            [q.window, 80],
            [q.used, 60],
            [q.resets_in, 90, t.muted],
            [q.pace, 80, (q.pace_percent ?? 0) > 100 ? t.blocked : t.muted],
            [q.note, null, t.dim],
          ]),
        ),
      );
      out.push(this.note(t, "Pace: where usage ends up by the reset at the rate so far (shown after a quarter of the window)."));
    }

    if (tab === "Stats") {
      const s = (this.rows.Stats ?? [])[0];
      if (s) {
        const ai = Object.entries(s.ai_marked ?? {})
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
        [
          ["Merged (30 days)", s.merged],
          ["With agent sessions", s.with_agent_sessions],
          ["Agent cost matched to PRs", money(s.cost_usd)],
          ["Per PR with agent work", money(s.cost_per_pr_usd)],
          ["Median time to merge", s.median_hours_to_merge == null ? "—" : `${s.median_hours_to_merge}h`],
          ["Marked as AI-made", ai],
          ["Open", `${s.open}${s.oldest_open_days != null ? `, oldest ${s.oldest_open_days} days` : ""}`],
        ].forEach(([k, v], i) => out.push(this.line(t, `stat-${i}`, [[k, 200, t.muted], [v, null]])));
        out.push(div().px(10).pt(14).pb(4).text_size(12).font_semibold().child("Pull requests"));
        out.push(this.head(t, [["Merged", 80], ["Cost", 70], ["Sessions", 64], ["PR", 230], ["Title", null]]));
        (this.rows.Prs ?? []).slice(0, 60).forEach((p, i) =>
          out.push(
            this.line(t, `pr-${i}`, [
              [p.merged, 80, t.dim],
              [money(p.cost_usd), 70, p.cost_usd ? t.foreground : t.dim],
              [p.agent_sessions || "", 64, t.muted],
              [p.pr, 230, t.muted],
              [p.title, null],
            ]),
          ),
        );
      }
    }
    return out;
  }

  renderOverlay(t) {
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .child(
        h_flex()
          .px(12)
          .pt(10)
          .pb(8)
          .gap(4)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(image(ICON).w(18).h(18).mr(4))
          .child(div().pr(10).text_size(13).font_semibold().child("Trailboss"))
          .children(
            TABS.map((name) =>
              div()
                .id(`tab-${name}`)
                .cursor_pointer()
                .px(10)
                .py(3)
                .rounded(5)
                .text_size(12)
                .bg(this.tab === name ? t.selected : t.surface)
                .text_color(this.tab === name ? t.foreground : t.muted)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.show(name, cx))
                .child(name),
            ),
          )
          .child(div().flex_1())
          .child(
            div()
              .id("open-insights")
              .cursor_pointer()
              .px(8)
              .py(3)
              .rounded(5)
              .text_size(12)
              .text_color(t.muted)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => {
                openOverlay({ mod: MOD, props: { view: "insights" }, kind: "window", key: "trailboss-insights", width: 1100, height: 820 });
                closeOverlay(this.overlay);
              })
              .child("Insights ↗"),
          )
          .child(
            div()
              .id("refresh")
              .cursor_pointer()
              .px(8)
              .text_size(12)
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => cx.spawn((cx) => this.load(cx, this.tab)))
              .child(this.loading[this.tab] ? "…" : "↻"),
          ),
      )
      .child(v_flex().id("tb-body").flex_1().min_h(0).p(8).gap(1).overflow_y_scrollbar().children(this.body(t)));
  }

  // ---------------------------------------------------------------- the status-bar block

  render() {
    return this.renderOverlay(theme());
  }
}
