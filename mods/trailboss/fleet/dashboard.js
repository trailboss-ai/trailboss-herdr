import { div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, notify, run, shared, setShared } from "herdr";
import { liveTree, liveList } from "./tree.js";
import { statusFor, modelParts, contextText, turnText, resources, CONTEXT_WARN } from "./live.js";
import { openInsights } from "../usage/insights.js";
import { ICON, cliStatus, setupStep, blockInLayout, tb, plural, money, daysAgo, short, statusColor } from "../lib.js";

// The dashboard (Alt+Shift+T, or click the status block): Live, Sessions, Usage, Quota and
// Stats, each one Trailboss command, plus a button for the Insights window.

const TABS = ["Live", "Sessions", "Usage", "Quota", "Stats"];
// The last `trailboss stats` result, shared with the Stats side panel (same shape there).
const STATS_KEY = "trailboss.stats";

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
    this.typed = 0;
    this.input.on("submit", (_e, cx) => this.load(cx, "Sessions"));
    // Search as you type, once typing pauses.
    this.input.on("change", (_e, cx) => {
      const n = ++this.typed;
      cx.spawn(async (cx) => {
        await new Promise((r) => cx.timer.after(300, () => r()));
        if (n === this.typed) await this.load(cx, "Sessions");
      });
    });
    this.cli = null; // cliStatus() while the CLI is missing or too old
    this.inLayout = true; // whether the status-bar block is in the current layout
    this.setup = null; // a setup step's progress or failure
    cx.spawn((cx) => this.start(cx));
    // The Live tab stays live while open.
    cx.timer.every(5000, (cx) => {
      if (this.tab === "Live") cx.spawn((cx) => this.load(cx, "Live"));
    });
  }

  async start(cx) {
    const s = await cliStatus();
    this.cli = s.problem ? s : null;
    this.bin = s.problem ? null : s.bin;
    this.inLayout = (await blockInLayout()) !== false;
    cx.notify();
    if (this.bin) await this.load(cx, this.tab);
  }

  // A setup step from setup_mod.py, only ever on a click: "get-cli" or "add-block".
  async runSetup(cx, step) {
    this.setup = step === "get-cli" ? "Installing…" : "Adding the block…";
    cx.notify();
    const r = await setupStep(step);
    this.setup = r.ok ? null : r.message;
    if (r.ok) notify({ title: r.message, level: "success", icon: ICON });
    await this.start(cx);
  }

  // What's missing for Trailboss to work, with the button that fixes it.
  setupBanner(t) {
    const cli = this.cli;
    const text = cli ? cli.text : !this.inLayout ? "Trailboss's status-bar block isn't in this layout: tracking and resume need it." : null;
    if (!text) return [];
    const label = cli ? (cli.problem === "missing" ? "Install" : cli.problem === "old" ? "Update" : null) : "Add to layout";
    const step = cli ? "get-cli" : "add-block";
    return [
      h_flex()
        .px(10)
        .py(6)
        .gap(10)
        .items_center()
        .text_size(12)
        .child(div().flex_1().text_color(t.blocked).child(this.setup ?? text))
        .when(Boolean(label) && !this.setup?.endsWith("…"), (el) =>
          el.child(
            div()
              .id("setup")
              .cursor_pointer()
              .px(8)
              .py(2)
              .rounded(4)
              .bg(t.accent)
              .text_color(t.accent_foreground)
              .hover((s) => s.opacity(0.85))
              .on_click((_e, cx) => cx.spawn((cx) => this.runSetup(cx, step)))
              .child(label),
          ),
        ),
    ];
  }

  async load(cx, tab) {
    if (!this.bin || this.loading[tab]) return;
    this.loading[tab] = true;
    cx.notify();
    try {
      if (tab === "Live") {
        this.rows.Live = await tb(["live"]);
        this.rows.Lost = await tb(["resume", "--dry-run"]);
      } else if (tab === "Sessions") {
        // An empty box lists recent sessions; words search them, best hit per session.
        const q = this.input.value().trim();
        const words = q.split(/\s+/).filter(Boolean);
        this.query = q;
        if (!words.length) {
          this.rows.Sessions = await tb(["sessions", "-n", "40"]);
        } else {
          const seen = new Set();
          this.rows.Sessions = (await tb(["search", "-n", "200", ...words]))
            .filter((h) => !seen.has(`${h.agent}/${h.session_id}`) && seen.add(`${h.agent}/${h.session_id}`))
            .slice(0, 40);
        }
      } else if (tab === "Usage") {
        this.rows.Usage = await tb(["usage", "--by", "day", "--since", daysAgo(13)]);
        this.rows.Models = await tb(["usage", "--by", "model", "--since", daysAgo(29)]);
        this.rows.Plans = await tb(["plans"]);
      } else if (tab === "Quota") {
        this.rows.Quota = await tb(["quota"]);
      } else if (tab === "Stats") {
        // GitHub takes seconds: show the last result now, marked stale, while it answers.
        const last = shared(STATS_KEY);
        if (!this.rows.Stats && last?.s) {
          this.rows.Stats = [last.s];
          this.rows.Prs = last.s.prs ?? [];
          this.statsAt = last.at;
          cx.notify();
        }
        // One GitHub round: the summary carries the per-PR rows under `prs`.
        const rows = await tb(["stats"]);
        this.rows.Stats = rows;
        this.rows.Prs = rows[0]?.prs ?? [];
        this.statsAt = Date.now();
        if (rows[0]) setShared(STATS_KEY, { at: this.statsAt, s: rows[0] });
      }
      this.errors[tab] = null;
    } catch (e) {
      this.errors[tab] = String(e?.message ?? e);
    } finally {
      this.loading[tab] = false;
    }
    cx.notify();
    // Typing during a search is dropped by the loading guard above; catch up now.
    if (tab === "Sessions" && !this.errors.Sessions && this.input.value().trim() !== this.query)
      cx.spawn((cx) => this.load(cx, "Sessions"));
  }

  show(tab, cx) {
    this.tab = tab;
    if (tab === "Sessions") this.input.focus();
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

  // One agent in the Live tab: where, status and since when, cost and session; under it why
  // it needs you (else its turn), what it runs as and its processes' load. Click to focus
  // its terminal.
  liveRow(t, r, depth, tree, i) {
    const sharing = r.shares_with?.length ?? 0;
    const parent = r.parent ? `↳ from ${r.parent.split(" ")[0]} · ` : "";
    const now = Date.now();
    const indent = `${"   ".repeat(depth)}${depth ? "   " : ""}`;
    // The context's share stays quiet until it's nearly full.
    const ctx = contextText(r);
    const full = (r.context_pct ?? 0) > CONTEXT_WARN;
    const runs = modelParts(r);
    const load = resources(r);
    // Only Herdr's own terminals can be focused from here.
    const focus =
      r.terminal && (r.host ?? "herdr") === "herdr"
        ? () => {
            run("pane.focus", { terminal: r.terminal });
            closeOverlay(this.overlay);
          }
        : null;
    return v_flex()
      .id(`live-${i}`)
      .rounded(5)
      .when(Boolean(focus), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(focus))
      .child(
        this.line(t, `live-${i}-top`, [
          [`${"   ".repeat(depth)}${depth ? "└ " : ""}${r.where}`, 260],
          r.stuck ? [`stuck ${r.quiet_min}m`, 96, t.blocked] : [statusFor(r, now), 96, statusColor(t, r.status)],
          [money(r.cost_usd), 70, t.muted],
          !tree && sharing
            ? [`${parent}⇄ ${sharing + 1} in folder · ${r.title ?? r.cwd}`, null, t.working]
            : [`${tree ? "" : parent}${r.title ?? r.cwd ?? ""}`, null, t.muted],
        ]),
      )
      .child(
        h_flex()
          .id(`live-${i}-under`)
          .px(10)
          .pb(4)
          .gap(12)
          .text_size(11)
          .text_color(t.dim)
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .when(Boolean(r.needs), (el) => el.text_color(t.blocked))
              .child(`${indent}${r.pinned ? "pinned · " : ""}${r.needs ?? turnText(r, now)}`),
          )
          .when(runs.length > 0, (el) =>
            el.child(
              h_flex()
                .flex_none()
                .gap(4)
                .child(div().text_color(t.muted).child(runs.filter((p) => p !== ctx).join(" · ")))
                .when(Boolean(ctx), (el) =>
                  el.child(div().text_color(full ? t.blocked : t.dim).child(`${runs.length > 1 ? "· " : ""}${ctx}`)),
                ),
            ),
          )
          .when(Boolean(load), (el) => el.child(div().flex_none().w(110).child(load))),
      );
  }

  body(t) {
    const tab = this.tab;
    const err = this.errors[tab] ?? this.error;
    const out = [...this.setupBanner(t)];
    if (this.cli) return out;
    if (err) out.push(this.note(t, err, t.blocked));
    if (this.loading[tab] && !this.rows[tab]) out.push(this.note(t, tab === "Stats" ? "Asking GitHub…" : "Loading…"));

    if (tab === "Live") {
      const rows = this.rows.Live ?? [];
      const tree = this.liveView !== "list";
      out.push(
        h_flex()
          .px(10)
          .pb(6)
          .gap(10)
          .text_size(11.5)
          .children(
            [["tree", "By folder"], ["list", "List"]].map(([v, label]) =>
              div()
                .id(`view-${v}`)
                .cursor_pointer()
                .text_color((v === "tree") === tree ? t.foreground : t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => {
                  this.liveView = v;
                  cx.notify();
                })
                .child(label),
            ),
          ),
      );
      out.push(this.head(t, [["Where", 260], ["Status", 96], ["Cost", 70], ["Session", null]]));
      // By folder: agents sharing a folder under one heading, sub-agents indented under the
      // agent that started them. List: one row each, as `live` returns them.
      const lines = tree ? liveTree(rows) : liveList(rows);
      lines.forEach(({ group: g, row: r, depth }, i) => {
        if (g) {
          // More than one agent working in one folder can overwrite each other's changes.
          const busy = g.working > 1;
          out.push(
            div()
              .px(10)
              .pt(8)
              .pb(2)
              .text_size(11.5)
              .text_color(busy ? t.working : t.dim)
              .child(
                `${busy ? "⚠ " : ""}${g.name} · ${g.count} ${g.count === 1 ? "agent" : "agents"}` +
                  `${g.needs ? ` · ${g.needs} ${g.needs === 1 ? "needs" : "need"} you` : ""}${g.working ? ` · ${g.working} working` : ""}`,
              ),
          );
          return;
        }
        out.push(this.liveRow(t, r, depth, tree, i));
      });
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

    if (tab === "Sessions") {
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
      // Rows are search hits when there's a query, else recent sessions from `trailboss sessions`.
      const rows = this.rows.Sessions;
      if (rows && !rows.length) out.push(this.note(t, this.query ? "No matches." : "No sessions indexed yet."));
      if (rows?.length && !this.query)
        out.push(this.note(t, "Recent sessions. Type to search them all; click one to reopen it in a new tab."));
      (rows ?? []).forEach((r, i) =>
        out.push(
          this.line(
            t,
            `hit-${i}`,
            [
              [(r.ts ?? r.ended ?? r.started ?? "").slice(0, 10), 80, t.dim],
              [r.agent, 60, t.muted],
              [short(r.title ?? r.first_prompt, 40), 230],
              [r.snippet ?? r.cwd, null, t.muted],
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
      if (s && this.loading.Stats && this.statsAt) {
        const m = Math.round((Date.now() - this.statsAt) / 60000);
        out.push(this.note(t, `Asking GitHub… showing the result from ${m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`}`));
      }
      if (s) {
        const ai = Object.entries(s.ai_marked ?? {})
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
        [
          ["Merged (30 days)", s.merged],
          ["With agent sessions", s.with_agent_sessions],
          ["Agent cost matched to PRs", money(s.cost_usd)],
          ["Per PR with agent work", money(s.cost_per_pr_usd)],
          ["Incl. work on main (est.)", `${money(s.estimated_cost_usd)} · ${money(s.estimated_cost_per_pr_usd)} per PR`],
          ["Median time to merge", s.median_hours_to_merge == null ? "—" : `${s.median_hours_to_merge}h`],
          ["Marked as AI-made", ai],
          ["Open", `${s.open}${s.oldest_open_days != null ? `, oldest ${s.oldest_open_days} days` : ""}`],
        ].forEach(([k, v], i) => out.push(this.line(t, `stat-${i}`, [[k, 200, t.muted], [v, null]])));
        out.push(div().px(10).pt(14).pb(4).text_size(12).font_semibold().child("Pull requests"));
        out.push(this.head(t, [["Merged", 80], ["Cost", 70], ["Est.", 70], ["Sessions", 64], ["PR", 230], ["Title", null]]));
        (this.rows.Prs ?? []).slice(0, 60).forEach((p, i) =>
          out.push(
            this.line(t, `pr-${i}`, [
              [p.merged, 80, t.dim],
              [money(p.cost_usd), 70, p.cost_usd ? t.foreground : t.dim],
              [p.estimated_cost_usd != null && p.estimated_cost_usd !== p.cost_usd ? `est. ${money(p.estimated_cost_usd)}` : "", 70, t.muted],
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
                openInsights();
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
          )
          .child(
            div()
              .id("close")
              .cursor_pointer()
              .px(8)
              .text_size(12)
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .tooltip("Close (Esc)")
              .on_click(() => closeOverlay(this.overlay))
              .child("✕"),
          ),
      )
      .child(v_flex().id("tb-body").flex_1().min_h(0).p(8).gap(1).overflow_y_scrollbar().children(this.body(t)));
  }

  // ---------------------------------------------------------------- the status-bar block

  render() {
    return this.renderOverlay(theme());
  }
}
