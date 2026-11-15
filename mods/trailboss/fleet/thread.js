import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { theme, run, focused, panes, notify, shared, setShared } from "herdr";
import { tb, err, money, compact, duration, longDate, short, statusColor } from "../lib.js";
import { quote, matching, day, lines, codeBlocks } from "./turns.js";
import { treeLines, treeCounts, nodeAction } from "./threadtree.js";

// A pane beside an agent's terminal with only the conversation: each prompt and its reply,
// newest first, a band per day. Search, open a turn, copy or quote its reply (or one of its
// code blocks). Reads `trailboss thread`, so the agent's files are only ever read; quoting
// pastes into the terminal and never presses Enter. The Tree view (`thread --tree`) shows the
// session among the ones forked, started or run as subagents around it; with a CLI that has
// no tree it stays hidden.

const ALIVE = "trailboss.threads"; // terminal → when its pane last ticked
const AGENT_TURNS = "trailboss.thread.agent"; // show messages the agent sent itself (task reports)
const TICK = 2000;

// Opens the thread pane to the right of the focused agent terminal, or moves to it if open.
export function openThread() {
  const terminal = focused()?.terminal;
  if (!terminal) {
    notify({ title: "Trailboss", body: "Focus an agent's terminal first, then open its thread." });
    return;
  }
  if (Date.now() - ((shared(ALIVE) ?? {})[terminal] ?? 0) < TICK * 2) {
    run("pane.go", { direction: "right" });
    return;
  }
  run("pane.split", { direction: "right", mod: "trailboss", props: { view: "thread", terminal } });
}

export class Thread {
  init(p, cx) {
    this.terminal = p.terminal ?? focused()?.terminal ?? null;
    this.session = null; // the live row: {agent, session, title}
    this.turns = null;
    this.error = null;
    this.open = null; // the open turn's n
    this.copied = null;
    this.status = undefined;
    this.loaded = 0;
    this.view = "turns"; // or "tree"
    this.tree = null; // `thread --tree` for this session; null while there's none (or no CLI support)
    this.treeFor = null; // the AGENT:ID the tree is for
    this.treeLoading = false;
    this.search = InputState.new({ placeholder: "Search prompts and replies…" });
    this.search.on("change", (_e, cx) => cx.notify());
    cx.spawn((cx) => this.load(cx, true));
    cx.timer.every(TICK, (cx) => this.tick(cx));
  }

  // Reload when the agent's status changes (a turn ended, or a new session after /clear),
  // while it works, and now and then for agents that report no status.
  tick(cx) {
    setShared(ALIVE, { ...(shared(ALIVE) ?? {}), [this.terminal]: Date.now() });
    const status = panes().find((x) => x.terminal === this.terminal)?.status ?? null;
    const changed = status !== this.status;
    const every = status === "working" ? 5000 : 15000;
    if (changed || Date.now() - this.loaded > every) cx.spawn((cx) => this.load(cx, changed));
    this.status = status;
  }

  async load(cx, find) {
    if (this.loading) return;
    this.loading = true;
    try {
      if (find || !this.session) {
        const live = await tb(["live"]);
        const row = live.find((r) => r.host === "herdr" && r.terminal === this.terminal);
        if (row?.session) this.session = row;
      }
      if (!this.session) throw new Error("No agent session in this terminal yet.");
      this.turns = await tb(["thread", this.key()]);
      this.error = null;
      cx.spawn((cx) => this.loadTree(cx));
    } catch (e) {
      this.error = err(e);
    }
    this.loaded = Date.now();
    this.loading = false;
    cx.notify();
  }

  key() {
    return this.session ? `${this.session.agent}:${this.session.session}` : null;
  }

  // The tree around the session, on its own so a slow or failing call never holds up the
  // conversation. A CLI without `--tree` fails it: the Tree view then stays hidden.
  async loadTree(cx) {
    const key = this.key();
    if (!key || this.treeLoading) return;
    if (this.treeFor !== key) this.tree = null; // a new session (after /clear)
    this.treeLoading = true;
    try {
      const data = await tb(["thread", key, "--tree"]);
      if (this.key() === key && Array.isArray(data?.nodes)) {
        this.tree = data;
        this.treeFor = key;
      }
    } catch {
      if (this.treeFor !== key) this.tree = null;
    }
    this.treeLoading = false;
    if (!this.tree && this.view === "tree") this.view = "turns";
    cx.notify();
  }

  copy(cx, text, what) {
    cx.write_to_clipboard(text);
    this.copied = what;
    cx.notify();
  }

  // Into the terminal's prompt as a > quote, through the clipboard (a bracketed paste, so
  // nothing in it runs), then focus there to write the comment.
  quote(cx, text) {
    cx.write_to_clipboard(quote(text));
    run("pane.focus", { terminal: this.terminal });
    run("terminal.paste");
  }

  render() {
    const t = theme();
    const s = this.session;
    const tree = this.view === "tree" && this.tree ? this.tree : null;
    const turn = !tree && this.open != null ? this.turns?.find((x) => x.n === this.open) : null;
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.background)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .when(Boolean(turn), (el) => el.child(this.button(t, "back", "‹ All", () => (this.open = null))))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().child(s ? `${s.agent} · ${s.title ?? s.session}` : "Thread"))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(tree ? treeCounts(tree) : this.turns ? `${this.turns.length} turns` : ""))
          .when(Boolean(this.tree), (el) =>
            el.child(this.button(t, "view", tree ? "Turns" : "Tree", () => (this.view = tree ? "turns" : "tree")).tooltip(tree ? "Back to the conversation" : "This session among its forks, subagents and the sessions it started")),
          )
          .child(this.button(t, "close", "×", () => run("pane.close"))),
      )
      .when(Boolean(this.error), (el) => el.child(div().p(12).text_size(12).text_color(t.muted).child(this.error)))
      .child(tree ? this.treeView(t, tree) : turn ? this.detail(t, turn) : this.list(t));
  }

  // One line per turn, branches indented under the turn they come from; the pane's own
  // session stands out. A turn of this session opens it; another session's focuses its terminal.
  treeView(t, tree) {
    const mine = tree.focus ?? this.key(); // the CLI names the pane's session as it knows it
    const rows = treeLines(tree, mine).map((l, i) => {
      const act = nodeAction(l.node, tree, mine);
      return h_flex()
        .id(`node-${i}`)
        .mx(8)
        .px(8)
        .py(3)
        .pl(8 + l.depth * 16)
        .gap(6)
        .items_center()
        .rounded(5)
        .text_size(12)
        .when(l.mine, (el) => el.bg(t.surface))
        .when(Boolean(act), (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              if (act.terminal) {
                run("pane.focus", { terminal: act.terminal });
                return;
              }
              if (this.turns?.some((x) => x.n === act.turn)) this.open = act.turn;
              this.view = "turns";
              this.copied = null;
              cx.notify();
            }),
        )
        .when(Boolean(l.marker), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child(l.marker)))
        .child(div().flex_1().min_w(0).truncate().text_color(l.mine ? t.foreground : t.muted).when(l.mine, (x) => x.font_semibold()).child(l.label))
        .when(Boolean(l.state), (el) => el.child(div().flex_none().text_size(11).text_color(statusColor(t, l.state)).child(l.state)));
    });
    return v_flex()
      .id("tree")
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .py(8)
      .gap(1)
      .children(rows)
      .when(!rows.length, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("No turns yet.")));
  }

  button(t, id, label, act) {
    return div()
      .id(`b-${id}`)
      .flex_none()
      .px(6)
      .py(1)
      .rounded(4)
      .cursor_pointer()
      .text_size(11.5)
      .text_color(t.muted)
      .hover((x) => x.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        act(cx);
        cx.notify();
      })
      .child(label);
  }

  list(t) {
    const q = this.search.value();
    const all = shared(AGENT_TURNS) === true;
    const shown = matching((this.turns ?? []).filter((x) => all || x.from !== "agent"), q).slice().reverse();
    const hidden = (this.turns ?? []).filter((x) => x.from === "agent").length;
    const rows = [];
    let band = null;
    // Turns per day, counted once: a long session has thousands, and this runs on every render.
    const days = shown.map((x) => day(x.ts));
    const perDay = new Map();
    for (const d of days) perDay.set(d, (perDay.get(d) ?? 0) + 1);
    for (const [i, x] of shown.entries()) {
      const d = days[i];
      if (d !== band) {
        band = d;
        const n = perDay.get(d);
        rows.push(div().px(12).pt(10).pb(4).text_size(11).text_color(t.dim).child(`${longDate(d)} · ${n} ${n === 1 ? "turn" : "turns"}`));
      }
      rows.push(this.row(t, x));
    }
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        h_flex()
          .p(8)
          .gap(6)
          .flex_none()
          .items_center()
          .child(Input.new(this.search).flex_1().h(28).px(8).rounded(5).border_1().border_color(t.input).bg(t.surface).text_size(12))
          .when(hidden > 0, (el) => el.child(this.button(t, "agent-turns", all ? "Hide agent messages" : `Agent messages (${hidden})`, () => setShared(AGENT_TURNS, !all)))),
      )
      .child(
        v_flex()
          .id("turns")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .pb(8)
          .children(rows)
          .when(this.turns && !shown.length, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child(q ? "No turn matches." : "No prompts yet."))),
      );
  }

  row(t, x) {
    const time = x.ts ? new Date(x.ts).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }) : "";
    return v_flex()
      .id(`turn-${x.n}`)
      .mx(8)
      .my(2)
      .px(8)
      .py(6)
      .gap(3)
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.open = x.n;
        this.copied = null;
        cx.notify();
      })
      .child(
        h_flex()
          .gap(6)
          .text_size(11)
          .text_color(t.dim)
          .child(div().child(`#${x.n}`))
          .when(x.from === "agent", (el) => el.child(div().text_color(t.accent).child("agent")))
          .child(div().flex_1().child(time))
          .when(x.cost_usd != null, (el) => el.child(div().child(money(x.cost_usd)))),
      )
      .children(lines(x.prompt, 2).map((l) => div().text_size(12.5).font_semibold().truncate().child(l)))
      .children(lines(x.reply, 3).map((l) => div().text_size(12).text_color(t.muted).truncate().child(l)))
      .when(!x.reply, (el) => el.child(div().text_size(12).text_color(t.dim).child("…")));
  }

  detail(t, x) {
    const took = x.ts && x.ended ? Date.parse(x.ended) - Date.parse(x.ts) : null;
    const stats = [
      x.model,
      x.tokens ? `${compact(x.tokens)} tokens` : null,
      x.cost_usd != null ? money(x.cost_usd) : null,
      took != null ? duration(took) : null,
      x.tools ? `${x.tools} tool ${x.tools === 1 ? "result" : "results"}` : null,
    ].filter(Boolean);
    const blocks = codeBlocks(x.reply);
    return v_flex()
      .id("detail")
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .p(12)
      .gap(10)
      .child(div().text_size(11).text_color(t.dim).child(`#${x.n} · ${x.ts ? new Date(x.ts).toLocaleString("en") : ""}`))
      .child(div().p(8).rounded(6).bg(t.surface).child(TextView.markdown(`p-${x.n}`, x.prompt || "*Empty prompt.*").selectable(true).text_size(12.5)))
      .child(TextView.markdown(`r-${x.n}`, x.reply || "*No reply yet.*").selectable(true).text_size(12.5))
      .child(div().text_size(11).text_color(t.dim).child(stats.join(" · ")))
      .child(
        h_flex()
          .gap(6)
          .flex_wrap()
          .child(this.button(t, "copy", this.copied === "reply" ? "Copied" : "Copy reply", (cx) => this.copy(cx, x.reply, "reply")))
          .child(this.button(t, "quote", "Quote into the prompt", (cx) => this.quote(cx, x.reply)))
          .child(this.button(t, "copy-prompt", this.copied === "prompt" ? "Copied" : "Copy prompt", (cx) => this.copy(cx, x.prompt, "prompt")))
          .children(blocks.map((b, i) => this.button(t, `code-${i}`, this.copied === `code-${i}` ? "Copied" : `Copy code ${blocks.length > 1 ? i + 1 : ""}`.trim() + ` (${short(b.split("\n")[0], 24)})`, (cx) => this.copy(cx, b, `code-${i}`)))),
      );
  }
}
