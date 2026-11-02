import { div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list } from "gpui-base";
import { theme, settings, closeOverlay } from "herdr";
import { tb, err, short, age } from "../lib.js";
import { openInEditor } from "./files.js";

// Review by agent session (a window, from the Changes panel): the sessions that changed
// files in this repository; one session's files, what each was before, whether it still
// differs and who changed it since; the diff; and undo, per file or the whole session.
// Undo restores each file from Claude Code's own backups (other agents keep none), keeps
// what it replaces, and skips files another session changed later.

const AGENT_COLORS = { claude: "#d4704f", codex: "#3f86e0", opencode: "#8f6fe0", pi: "#3fb27f" };

export class Review {
  init(p, cx) {
    this.overlay = p.overlay;
    this.root = p.root;
    this.sessions = null;
    this.session = null; // "agent:id"
    this.files = [];
    this.open = null; // path whose diff shows
    this.rows = [];
    this.confirm = null; // "file:<path>" | "session"
    this.result = null;
    this.error = null;
    cx.spawn((cx) => this.loadSessions(cx));
  }

  rel(p) {
    return this.root && p.startsWith(`${this.root}/`) ? p.slice(this.root.length + 1) : p;
  }

  async loadSessions(cx) {
    try {
      this.sessions = await tb(["review", "--under", this.root, "-n", "40"]);
      if (!this.session && this.sessions.length) await this.pick(cx, `${this.sessions[0].agent}:${this.sessions[0].session}`);
    } catch (e) {
      this.error = err(e);
    }
    cx.notify();
  }

  async pick(cx, s) {
    this.session = s;
    this.open = null;
    this.rows = [];
    this.confirm = null;
    this.result = null;
    try {
      this.files = await tb(["review", s]);
    } catch (e) {
      this.error = err(e);
    }
    cx.notify();
  }

  async showDiff(cx, path) {
    this.open = path;
    this.confirm = null;
    try {
      const { diff } = await tb(["review", this.session, "--diff", path]);
      this.rows = diff.split("\n");
    } catch (e) {
      this.rows = [err(e)];
    }
    cx.notify();
  }

  async undo(cx, path) {
    const args = ["review", this.session, "--undo", "--yes", ...(path ? ["--path", path] : [])];
    try {
      this.result = await tb(args);
    } catch (e) {
      this.result = [{ action: "failed", path: path ?? "", detail: err(e) }];
    }
    this.confirm = null;
    this.files = await tb(["review", this.session]).catch(() => this.files);
    if (this.open) await this.showDiff(cx, this.open);
    cx.notify();
  }

  button(t, id, label, onClick, danger) {
    return div()
      .id(id)
      .cursor_pointer()
      .px(8)
      .py(2)
      .rounded(4)
      .text_size(11.5)
      .bg(danger ? t.blocked : t.raised)
      .text_color(danger ? t.background : t.foreground)
      .hover((s) => s.opacity(0.85))
      .on_click((e, cx) => {
        cx.stop_propagation();
        onClick(e, cx);
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(label);
  }

  sessionList(t) {
    return (this.sessions ?? []).map((s, i) => {
      const key = `${s.agent}:${s.session}`;
      const sel = key === this.session;
      return v_flex()
        .id(`s-${i}`)
        .px(8)
        .py(5)
        .gap(1)
        .rounded(6)
        .cursor_pointer()
        .when(sel, (el) => el.bg(t.selected))
        .hover((st) => st.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => cx.spawn((cx) => this.pick(cx, key)))
        .child(
          h_flex()
            .gap(6)
            .child(div().text_size(10).font_semibold().text_color(AGENT_COLORS[s.agent] ?? t.accent).child(s.agent.toUpperCase()))
            .child(div().flex_1().truncate().text_size(12).child(s.title ?? s.session)),
        )
        .child(div().text_size(10.5).text_color(t.dim).child(`${s.files} files · ${s.edits} edits · ${age(s.last)} ago`));
    });
  }

  fileRow(t, f, i) {
    const later = f.later ?? [];
    const sel = this.open === f.path;
    const before = { backup: "modified", created: "created", unknown: "no backup", "backup missing": "backup gone" }[f.before] ?? f.before;
    return v_flex()
      .id(`f-${i}`)
      .px(8)
      .py(4)
      .gap(1)
      .rounded(5)
      .cursor_pointer()
      .when(sel, (el) => el.bg(t.selected))
      .hover((st) => st.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.spawn((cx) => this.showDiff(cx, f.path)))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_1().truncate().text_size(12).child(this.rel(f.path)))
          .child(div().text_size(10.5).text_color(t.dim).child(`${before}${f.differs === false ? " · as before" : ""}`)),
      )
      .when(later.length > 0, (el) =>
        el.child(
          div()
            .text_size(10.5)
            .text_color(t.working)
            .child(`changed later by ${later.map((l) => `${l.agent} ${short(l.title ?? "", 30)}`).join(", ")}`),
        ),
      );
  }

  render() {
    const t = theme();
    const f = this.files.find((x) => x.path === this.open);
    const undoable = this.files.filter((x) => x.before === "backup" || x.before === "created").length;
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(40)
          .flex_none()
          .px(12)
          .gap(10)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().text_size(13).font_semibold().child("Review by session"))
          .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(this.root ?? ""))
          .child(this.button(t, "close", "×", () => closeOverlay(this.overlay))),
      )
      .when(Boolean(this.error), (el) => el.child(div().px(12).py(4).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(
        h_flex()
          .flex_1()
          .min_h(0)
          .child(
            v_flex()
              .id("sessions")
              .w(280)
              .flex_none()
              .p(6)
              .gap(1)
              .border_r(1)
              .border_color(t.border)
              .overflow_y_scrollbar()
              .children(this.sessionList(t))
              .when(this.sessions?.length === 0, (el) =>
                el.child(div().p(8).text_size(12).text_color(t.dim).child("No agent session changed files here yet.")),
              ),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .child(
                h_flex()
                  .px(10)
                  .py(6)
                  .gap(8)
                  .items_center()
                  .border_b(1)
                  .border_color(t.border)
                  .child(div().flex_1().text_size(12).text_color(t.muted).child(this.session ? `${this.files.length} files · ${undoable} can be undone` : ""))
                  .when(Boolean(this.session) && undoable > 0 && this.confirm !== "session", (el) =>
                    el.child(this.button(t, "undo-all", "Undo session…", (_e, cx) => {
                      this.confirm = "session";
                      cx.notify();
                    })),
                  )
                  .when(this.confirm === "session", (el) =>
                    el
                      .child(div().text_size(11.5).text_color(t.blocked).child("Restore every file it changed?"))
                      .child(this.button(t, "undo-all-yes", "Undo session", (_e, cx) => cx.spawn((cx) => this.undo(cx, null)), true))
                      .child(this.button(t, "undo-all-no", "Cancel", (_e, cx) => {
                        this.confirm = null;
                        cx.notify();
                      })),
                  ),
              )
              .child(v_flex().id("files").flex_none().max_h(220).p(6).overflow_y_scrollbar().children(this.files.map((x, i) => this.fileRow(t, x, i))))
              .when(Boolean(this.result), (el) =>
                el.child(
                  v_flex()
                    .px(10)
                    .py(6)
                    .gap(1)
                    .border_t(1)
                    .border_color(t.border)
                    .bg(t.raised)
                    .children(
                      this.result.map((r, i) =>
                        div()
                          .id(`r-${i}`)
                          .truncate()
                          .text_size(11)
                          .text_color(r.action === "failed" ? t.blocked : r.action === "skip" ? t.dim : t.foreground)
                          .child(`${r.action}: ${this.rel(r.path)}${r.detail ? ` (${r.detail})` : ""}`),
                      ),
                    ),
                ),
              )
              .when(Boolean(f), (el) =>
                el.child(
                  h_flex()
                    .px(10)
                    .py(5)
                    .gap(8)
                    .items_center()
                    .border_t(1)
                    .border_b(1)
                    .border_color(t.border)
                    .child(div().flex_1().truncate().text_size(12).font_semibold().child(this.rel(f.path)))
                    .when(f.exists, (el) => el.child(this.button(t, "open", "Open", () => openInEditor(f.path))))
                    .when((f.before === "backup" || f.before === "created") && f.differs !== false && this.confirm !== `file:${f.path}`, (el) =>
                      el.child(this.button(t, "undo-file", "Undo file…", (_e, cx) => {
                        this.confirm = `file:${f.path}`;
                        cx.notify();
                      })),
                    )
                    .when(this.confirm === `file:${f.path}`, (el) =>
                      el.child(
                        this.button(t, "undo-file-yes", f.before === "created" ? "Move to trash" : "Restore before-session version", (_e, cx) =>
                          cx.spawn((cx) => this.undo(cx, f.path)),
                          true,
                        ),
                      ),
                    ),
                ),
              )
              .child(
                div()
                  .flex_1()
                  .min_h(0)
                  .font_family(settings().font_family ?? "monospace")
                  .text_size(11)
                  .when(Boolean(f) && this.rows.length > 0, (el) =>
                    el.child(
                      v_virtual_list("review-diff", this.rows.length, 18, (i) => String(i), (range) =>
                        this.rows.slice(range.start, range.end).map((l) =>
                          div()
                            .h(18)
                            .px(10)
                            .whitespace_nowrap()
                            .text_color(l.startsWith("+") ? t.done : l.startsWith("-") ? t.blocked : l.startsWith("@@") ? t.accent : t.foreground)
                            .child(l || " "),
                        ),
                      ).size_full(),
                    ),
                  )
                  .when(!f && this.files.length > 0, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child("Select a file to see what the session changed."))),
              ),
          ),
      );
  }
}
