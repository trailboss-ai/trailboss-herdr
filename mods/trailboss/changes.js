import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list } from "gpui-base";
import { exec, theme, settings, run, watchFolder, writeTextFile, appHome, notify } from "herdr";
import { tb, err, short } from "./lib.js";
import { here, trashPath, openInEditor } from "./files.js";
import { parseDiff, hunkPatch, counts, rows, parseStatus } from "./diff.js";

// Uncommitted changes in the focused terminal's repository, aware of agents: each file is
// badged with the agent that changed it (exactly or probably). Stage, unstage or discard
// whole files or single hunks, and commit. Discarding an untracked file moves it to the
// trash. Local repositories only (v1).

// Read-only git calls take no locks, so they never get in the way of an agent's git.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const ATTRIBUTE_MS = 15000;
const AGENT_COLORS = { claude: "#d4704f", codex: "#3f86e0", opencode: "#8f6fe0", pi: "#3fb27f" };

export class Changes {
  init(_p, cx) {
    this.root = null;
    this.files = [];
    this.marks = new Map();
    this.open = null; // { path, staged }
    this.diff = null;
    this.rows = [];
    this.confirm = null; // what's waiting for a second click to discard
    this.note = null;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("submit", (_e, cx) => cx.spawn((cx) => this.commit(cx)));
    cx.timer.every(1500, (cx) => cx.spawn((cx) => this.follow(cx)));
    cx.timer.every(ATTRIBUTE_MS, (cx) => cx.spawn((cx) => this.attribute(cx)));
    cx.spawn((cx) => this.follow(cx));
  }

  git(args, read = true) {
    return exec("git", [...(read ? READ : []), "-C", this.root, ...args]);
  }

  async follow(cx) {
    const cwd = here();
    if (!cwd || cwd === this.cwd) return;
    this.cwd = cwd;
    const top = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]).catch(() => null);
    const root = top?.code === 0 ? top.stdout.trim() : null;
    if (root === this.root) return;
    this.root = root;
    this.open = null;
    this.diff = null;
    this.files = [];
    this.marks.clear();
    if (!root) return cx.notify();
    await this.refresh(cx);
    this.attribute(cx);
    cx.spawn(async (cx) => {
      while (this.root === root) {
        try {
          await watchFolder(root);
        } catch {
          return;
        }
        if (this.root === root) await this.refresh(cx);
      }
    });
  }

  async refresh(cx) {
    if (!this.root || this.refreshing) return;
    this.refreshing = true;
    try {
      const st = await this.git(["status", "--porcelain=v1", "-z", "-b", "--untracked-files=all"]);
      if (st.code !== 0) throw new Error(st.stderr.trim());
      const { branch, files } = parseStatus(st.stdout);
      // +/- counts, staged and not.
      const num = {};
      for (const cached of [false, true]) {
        const r = await this.git(["diff", ...(cached ? ["--cached"] : []), "--numstat", "-z", "--no-renames"]);
        for (const f of r.stdout.split("\0").filter(Boolean)) {
          const [add, del, ...p] = f.split("\t");
          const k = `${cached ? "s" : "w"}:${p.join("\t")}`;
          num[k] = { add: add === "-" ? null : +add, del: del === "-" ? null : +del };
        }
      }
      this.branch = branch;
      this.files = files.map((f) => ({ ...f, staged: num[`s:${f.path}`], work: num[`w:${f.path}`] }));
      this.error = null;
      if (this.open) await this.load(cx, this.open.path, this.open.staged);
    } catch (e) {
      this.error = err(e);
    }
    this.refreshing = false;
    cx.notify();
  }

  async attribute(cx) {
    if (!this.root) return;
    try {
      const r = await tb(["changes", "--worktree", this.root]);
      this.marks = new Map(r.map((x) => [x.path, x]));
      cx.notify();
    } catch {}
  }

  async load(cx, path, staged) {
    const f = this.files.find((x) => x.path === path);
    if (!f) {
      this.open = null;
      this.diff = null;
      return cx.notify();
    }
    const untracked = f.x === "?";
    const r = untracked
      ? await this.git(["diff", "--no-index", "--no-color", "--", "/dev/null", path]) // exits 1 when different
      : await this.git(["diff", ...(staged ? ["--cached"] : []), "--no-color", "--no-ext-diff", "--", path]);
    this.open = { path, staged, untracked };
    this.diff = parseDiff(r.stdout);
    this.rows = rows(this.diff);
    this.confirm = null;
    cx.notify();
  }

  // Stage, unstage or discard one hunk by applying it as a patch.
  async hunk(cx, i, action) {
    const dir = `${appHome()}/data/trailboss`;
    await exec("mkdir", ["-p", dir]);
    const p = `${dir}/hunk-${Date.now()}.patch`;
    await writeTextFile(p, hunkPatch(this.diff, i), null);
    const flags = { stage: ["--cached"], unstage: ["--cached", "-R"], discard: ["-R"] }[action];
    const r = await this.git(["apply", ...flags, p], false);
    await exec("rm", ["-f", "--", p]);
    if (r.code !== 0) notify({ title: `Couldn't ${action} that hunk`, body: r.stderr.trim(), level: "error" });
    this.confirm = null;
    await this.refresh(cx);
  }

  async file(cx, path, action) {
    const f = this.files.find((x) => x.path === path);
    let r;
    if (action === "stage") r = await this.git(["add", "--", path], false);
    else if (action === "unstage") r = await this.git(["restore", "--staged", "--", path], false);
    else if (f?.x === "?") r = await trashPath(`${this.root}/${path}`); // never delete new work outright
    else r = await this.git(["restore", "--worktree", "--", path], false);
    if (r.code !== 0) notify({ title: `Couldn't ${action} ${path}`, body: (r.stderr || "").trim(), level: "error" });
    this.confirm = null;
    await this.refresh(cx);
  }

  // Commit what's staged; with nothing staged, everything (like Herdr's own Changes).
  async commit(cx) {
    const message = this.input.value().trim();
    if (!message) {
      this.note = "Write a commit message first.";
      return cx.notify();
    }
    const any = this.files.some((f) => f.x !== " " && f.x !== "?");
    if (!any) {
      const a = await this.git(["add", "-A"], false);
      if (a.code !== 0) {
        this.note = `Commit failed: ${a.stderr.trim()}`;
        return cx.notify();
      }
    }
    const r = await this.git(["commit", "-m", message], false);
    if (r.code !== 0) this.note = `Commit failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`;
    else {
      this.note = r.stdout.split("\n")[0];
      this.input.set_value?.("");
    }
    await this.refresh(cx);
  }

  badge(t, mark) {
    if (!mark?.agent) return null;
    const c = AGENT_COLORS[mark.agent] ?? t.accent;
    const exact = mark.how === "exact";
    return div()
      .px(4)
      .rounded(3)
      .text_size(9.5)
      .border_1()
      .border_color(c)
      .bg(exact ? c : t.surface)
      .text_color(exact ? t.background : c)
      .child(`${mark.agent}${exact ? "" : "?"}`);
  }

  small(t, id, label, onClick, danger) {
    return div()
      .id(id)
      .cursor_pointer()
      .px(5)
      .rounded(3)
      .text_size(11)
      .bg(danger ? t.blocked : t.raised)
      .text_color(danger ? t.background : t.muted)
      .hover((s) => s.text_color(t.foreground))
      .on_click((e, cx) => {
        cx.stop_propagation();
        onClick(e, cx);
      })
      .child(label);
  }

  fileRow(t, f, staged, i) {
    const n = staged ? f.staged : f.work;
    const mark = this.marks.get(f.path);
    const sel = this.open?.path === f.path && this.open?.staged === staged;
    const code = staged ? f.x : f.y === " " ? f.x : f.y;
    const key = `${staged ? "s" : "w"}:${f.path}`;
    return h_flex()
      .id(`row-${key}-${i}`)
      .px(8)
      .py(2)
      .gap(6)
      .items_center()
      .rounded(4)
      .cursor_pointer()
      .when(sel, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => cx.spawn((cx) => this.load(cx, f.path, staged)))
      .child(div().w(14).text_size(10.5).text_color(code === "D" ? t.blocked : code === "?" || code === "A" ? t.done : t.working).child(code === "?" ? "U" : code))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(f.path))
      .when(Boolean(n), (el) =>
        el.child(div().text_size(10.5).text_color(t.done).child(n.add == null ? "bin" : `+${n.add}`)).child(div().text_size(10.5).text_color(t.blocked).child(n.del == null ? "" : `−${n.del}`)),
      )
      .when(Boolean(this.badge(t, mark)), (el) => el.child(this.badge(t, mark)))
      .child(staged ? this.small(t, `u-${key}`, "−", (_e, cx) => cx.spawn((cx) => this.file(cx, f.path, "unstage"))) : this.small(t, `a-${key}`, "+", (_e, cx) => cx.spawn((cx) => this.file(cx, f.path, "stage"))));
  }

  diffRow(t, r) {
    const color = r.kind === "+" ? t.done : r.kind === "-" ? t.blocked : r.kind === "@" ? t.accent : t.foreground;
    const bg = r.kind === "+" ? t.ansi2 : r.kind === "-" ? t.ansi1 : null;
    if (r.kind === "@") {
      const h = r.hunk;
      const o = this.open;
      const discardKey = `hunk:${h}`;
      return h_flex()
        .id(`h-${h}`)
        .h(20)
        .px(8)
        .gap(6)
        .items_center()
        .bg(t.raised)
        .child(div().flex_1().truncate().text_color(t.accent).child(r.text))
        .when(!o.untracked, (el) =>
          el
            .child(
              o.staged
                ? this.small(t, `hu-${h}`, "Unstage hunk", (_e, cx) => cx.spawn((cx) => this.hunk(cx, h, "unstage")))
                : this.small(t, `hs-${h}`, "Stage hunk", (_e, cx) => cx.spawn((cx) => this.hunk(cx, h, "stage"))),
            )
            .when(!o.staged && this.confirm !== discardKey, (el) =>
              el.child(this.small(t, `hd-${h}`, "Discard", (_e, cx) => {
                this.confirm = discardKey;
                cx.notify();
              })),
            )
            .when(!o.staged && this.confirm === discardKey, (el) =>
              el.child(this.small(t, `hdy-${h}`, "Discard hunk?", (_e, cx) => cx.spawn((cx) => this.hunk(cx, h, "discard")), true)),
            ),
        );
    }
    return h_flex()
      .h(20)
      .px(8)
      .gap(8)
      .items_center()
      .when(Boolean(bg), (el) => el.bg(bg).opacity(0.9))
      .child(div().w(34).text_color(t.dim).child(r.old == null ? "" : String(r.old)))
      .child(div().w(34).text_color(t.dim).child(r.now == null ? "" : String(r.now)))
      .child(div().w(10).text_color(color).child(r.kind === "\\" ? "" : r.kind))
      .child(div().flex_1().whitespace_nowrap().text_color(r.kind === " " ? t.foreground : color).child(r.text || " "));
  }

  render() {
    const t = theme();
    const staged = this.files.filter((f) => f.x !== " " && f.x !== "?");
    const work = this.files.filter((f) => f.y !== " " || f.x === "?");
    const o = this.open;
    const mark = o ? this.marks.get(o.path) : null;
    const fileKey = o ? `file:${o.path}` : null;
    const total = this.diff ? counts(this.diff) : null;
    const list = [];
    if (staged.length) {
      list.push(div().px(8).pt(6).pb(2).text_size(11).text_color(t.dim).child(`Staged (${staged.length})`));
      staged.forEach((f, i) => list.push(this.fileRow(t, f, true, i)));
    }
    if (work.length) {
      list.push(div().px(8).pt(6).pb(2).text_size(11).text_color(t.dim).child(`Changes (${work.length})`));
      work.forEach((f, i) => list.push(this.fileRow(t, f, false, i)));
    }
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
          .child(div().text_size(13).font_semibold().child("Changes"))
          .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(this.branch ?? ""))
          .child(
            div()
              .id("hide")
              .cursor_pointer()
              .px(4)
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .on_click(() => run("layout.hide", { id: "panel" }))
              .child("›"),
          ),
      )
      .when(Boolean(this.error), (el) => el.child(div().px(12).pb(4).text_size(11).text_color(t.blocked).child(short(this.error, 200))))
      .child(
        v_flex()
          .id("file-list")
          .flex_none()
          .max_h(240)
          .px(4)
          .overflow_y_scrollbar()
          .children(list)
          .when(!list.length, (el) =>
            el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child(this.root ? "No uncommitted changes" : "Not a git repository")),
          ),
      )
      .when(Boolean(o), (el) =>
        el.child(
          v_flex()
            .px(10)
            .py(6)
            .gap(3)
            .border_t(1)
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .child(div().flex_1().truncate().text_size(12).font_semibold().child(o.path))
                .when(Boolean(total), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`+${total.add} −${total.del}`)))
                .child(this.small(t, "open-file", "Open", () => openInEditor(`${this.root}/${o.path}`)))
                .child(
                  o.staged
                    ? this.small(t, "unstage-file", "Unstage file", (_e, cx) => cx.spawn((cx) => this.file(cx, o.path, "unstage")))
                    : this.small(t, "stage-file", "Stage file", (_e, cx) => cx.spawn((cx) => this.file(cx, o.path, "stage"))),
                )
                .when(!o.staged && this.confirm !== fileKey, (el) =>
                  el.child(this.small(t, "discard-file", o.untracked ? "Trash" : "Discard", (_e, cx) => {
                    this.confirm = fileKey;
                    cx.notify();
                  })),
                )
                .when(!o.staged && this.confirm === fileKey, (el) =>
                  el.child(
                    this.small(t, "discard-yes", o.untracked ? "Move to trash?" : "Discard all changes?", (_e, cx) => cx.spawn((cx) => this.file(cx, o.path, "discard")), true),
                  ),
                ),
            )
            .when(Boolean(mark?.agent), (el) =>
              el.child(
                div()
                  .text_size(11)
                  .text_color(AGENT_COLORS[mark.agent] ?? t.accent)
                  .child(`${mark.how === "exact" ? "Changed by" : "Probably changed by"} ${mark.agent}${mark.title ? ` · ${short(mark.title, 60)}` : ""}`),
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
          .when(Boolean(o) && this.rows.length > 0, (el) =>
            el.child(
              v_virtual_list("diff", this.rows.length, 20, (i) => String(i), (range) =>
                this.rows.slice(range.start, range.end).map((r) => this.diffRow(t, r)),
              ).size_full(),
            ),
          )
          .when(Boolean(o) && this.rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No text diff (binary, or only a mode change).")))
          .when(!o && list.length > 0, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child("Select a file to see its changes."))),
      )
      .child(
        v_flex()
          .p(8)
          .gap(4)
          .border_t(1)
          .border_color(t.border)
          .child(
            h_flex()
              .gap(6)
              .child(Input.new(this.input).flex_1().h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12))
              .child(
                div()
                  .id("commit")
                  .cursor_pointer()
                  .px(10)
                  .py(5)
                  .rounded(6)
                  .text_size(12)
                  .bg(t.solid)
                  .text_color(t.solid_foreground)
                  .hover((s) => s.opacity(0.85))
                  .on_click((_e, cx) => cx.spawn((cx) => this.commit(cx)))
                  .child(staged.length ? "Commit" : "Commit all"),
              ),
          )
          .when(Boolean(this.note), (el) => el.child(div().text_size(11).text_color(t.muted).child(short(this.note, 160)))),
      );
  }
}
