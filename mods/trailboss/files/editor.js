import { div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input } from "gpui-base";
import { exec, theme, settings, readTextFile, writeTextFile, shared, appHome, notify } from "herdr";
import { tb, short } from "../lib.js";
import { OPEN_KEY } from "./files.js";
import { findAll, replaceNext, replaceAll } from "./find.js";

// A multi-tab editor that works alongside agents: saving never overwrites an agent's edit
// unseen (the save only lands if the file is still what you opened), files an agent
// changes reload by themselves when you haven't touched them, and a conflict says which
// agent probably made it, with reload / overwrite / compare. Local files only (v1).

const MAX_BYTES = 1024 * 1024; // what readTextFile reads
const POLL_MS = 2000;
// The highlighter takes file extensions (as Herdr's own Files viewer passes them), with a
// few spelled the way it knows them.
const LANG = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js",
  toml: "yaml", yml: "yaml", jsonc: "json", json5: "json", svelte: "html", vue: "html", htm: "html",
  cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", "h++": "cpp", ino: "cpp",
  markdown: "md", mdx: "md", zsh: "bash", sh: "bash", ksh: "bash", patch: "diff",
};
const BY_NAME = { Dockerfile: "dockerfile", Makefile: "make", "CMakeLists.txt": "cmake" };
function langOf(path) {
  const name = path.split("/").pop();
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return LANG[ext] ?? (ext || "text");
}
// Prose reads better wrapped; code doesn't.
const wrapsByDefault = (path) => ["md", "txt", "text", "rst", "adoc", "org", "tex"].includes(langOf(path));
const nameOf = (path) => path.split("/").pop();

async function fileInfo(path) {
  const r = await exec("stat", ["-c", "%Y %s", "--", path]);
  if (r.code !== 0) return null;
  const [mtime, size] = r.stdout.trim().split(" ").map(Number);
  return { mtime, size };
}

// Who probably changed `path` just now, from trailboss's attribution of its repository.
async function whoChanged(path) {
  try {
    const rows = await tb(["changes", "--worktree", path.replace(/\/[^/]+$/, "") || "/"]);
    const r = rows.find((x) => x.abs === path);
    return r?.agent ? `${r.how === "exact" ? "" : "probably "}${r.agent}${r.title ? ` (${short(r.title, 50)})` : ""}` : null;
  } catch {
    return null;
  }
}

export class EditorView {
  init(p, cx) {
    this.tabs = [];
    this.active = -1;
    this.handle = cx.focus_handle();
    this.seen = Date.now() - 10000; // take a request made just before this pane started
    this.closing = null;
    if (p.file) cx.spawn((cx) => this.open(cx, p.file));
    // Requests from the Files panel (or anyone) come through shared state.
    cx.timer.every(300, (cx) => {
      const req = shared(OPEN_KEY);
      if (req?.at > this.seen) {
        this.seen = req.at;
        cx.spawn((cx) => this.open(cx, req.path));
      }
    });
    cx.timer.every(POLL_MS, (cx) => cx.spawn((cx) => this.poll(cx)));
  }

  syntax() {
    const t = theme();
    return { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 };
  }

  async open(cx, path) {
    const at = this.tabs.findIndex((x) => x.path === path);
    if (at >= 0) {
      this.active = at;
      return cx.notify();
    }
    const info = await fileInfo(path);
    const tab = { path, dirty: false, conflict: null, notice: null, mtime: info?.mtime ?? 0 };
    let text = "";
    if (!info) tab.notice = "This file doesn't exist (any more).";
    else if (info.size > MAX_BYTES) tab.notice = `Too large to edit here (${(info.size / 1048576).toFixed(1)} MB; up to 1 MB).`;
    else {
      text = (await readTextFile(path)) ?? "";
      if (text.includes("\u0000")) {
        tab.notice = "A binary file: not shown.";
        text = "";
      }
    }
    tab.original = text;
    tab.wrap = wrapsByDefault(path);
    this.makeState(tab, text);
    this.tabs.push(tab);
    this.active = this.tabs.length - 1;
    cx.notify();
  }

  // The editor's options are fixed when it's made, so wrapping on or off makes it again,
  // with the same text.
  makeState(tab, value) {
    tab.state?.release?.();
    tab.state = EditorState.new({
      language: langOf(tab.path),
      value,
      readonly: Boolean(tab.notice),
      soft_wrap: tab.wrap,
      font_family: settings().font_family,
      syntax: this.syntax(),
    });
    tab.state.on("change", (_e, cx) => {
      tab.dirty = tab.state.value() !== tab.original;
      cx.notify();
    });
  }

  toggleWrap(cx) {
    const tab = this.tabs[this.active];
    if (!tab || tab.compare) return;
    tab.wrap = !tab.wrap;
    this.makeState(tab, tab.state.value());
    cx.notify();
  }

  // ---- find and replace. The editor can't move its cursor or mark text, so matches are
  // listed under the bar, with their lines.

  openFind(cx, withReplace) {
    if (!this.find) {
      this.find = { query: InputState.new({ placeholder: "Find" }), with: InputState.new({ placeholder: "Replace with" }) };
      this.find.query.on("change", (_e, cx) => this.search(cx));
      this.find.query.on("submit", (_e, cx) => this.search(cx));
      this.find.with.on("submit", (_e, cx) => this.replaceOne(cx));
      this.findOpts = { caseSensitive: false, regex: false };
    }
    this.findOpen = true;
    this.replaceOpen = withReplace || this.replaceOpen;
    this.find.query.focus();
    this.search(cx);
  }

  search(cx) {
    const tab = this.tabs[this.active];
    const q = this.find?.query.value() ?? "";
    try {
      this.matches = tab && q ? findAll(tab.state.value(), q, this.findOpts, 1000) : [];
      this.findError = null;
    } catch (e) {
      this.matches = [];
      this.findError = `Not a valid regex: ${String(e?.message ?? e).split(":").pop().trim()}`;
    }
    cx.notify();
  }

  // Replace edits the text as a whole; keep the previous text for one undo.
  replaceOne(cx) {
    const tab = this.tabs[this.active];
    if (!tab || tab.notice || tab.compare) return;
    const before = tab.state.value();
    try {
      const r = replaceNext(before, this.find.query.value(), this.find.with.value(), this.findOpts, this.replaceFrom ?? 0);
      if (!r) return this.search(cx);
      this.undoText = before;
      tab.state.set_value(r.text);
      tab.dirty = r.text !== tab.original;
      this.replaceFrom = r.at;
      this.findNote = `Replaced on line ${r.line}.`;
    } catch (e) {
      this.findError = String(e?.message ?? e);
    }
    this.search(cx);
  }

  replaceEvery(cx) {
    const tab = this.tabs[this.active];
    if (!tab || tab.notice || tab.compare) return;
    const before = tab.state.value();
    try {
      const r = replaceAll(before, this.find.query.value(), this.find.with.value(), this.findOpts);
      if (r.count) {
        this.undoText = before;
        tab.state.set_value(r.text);
        tab.dirty = r.text !== tab.original;
      }
      this.findNote = `Replaced ${r.count} match${r.count === 1 ? "" : "es"}.`;
    } catch (e) {
      this.findError = String(e?.message ?? e);
    }
    this.search(cx);
  }

  undoReplace(cx) {
    const tab = this.tabs[this.active];
    if (!tab || this.undoText == null) return;
    tab.state.set_value(this.undoText);
    tab.dirty = this.undoText !== tab.original;
    this.undoText = null;
    this.findNote = "Replace undone.";
    this.search(cx);
  }

  findBar(t) {
    const tab = this.tabs[this.active];
    const opt = (id, label, key) =>
      div()
        .id(id)
        .cursor_pointer()
        .px(6)
        .py(1)
        .rounded(4)
        .text_size(11)
        .bg(this.findOpts[key] ? t.selected : t.raised)
        .text_color(this.findOpts[key] ? t.foreground : t.muted)
        .on_click((_e, cx) => {
          this.findOpts[key] = !this.findOpts[key];
          this.search(cx);
        })
        .child(label);
    const n = this.matches?.length ?? 0;
    const input = (state) => Input.new(state).flex_1().h(26).px(8).rounded(5).border_1().border_color(t.input).bg(t.background).text_size(12);
    return v_flex()
      .px(10)
      .py(6)
      .gap(4)
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(input(this.find.query))
          .child(opt("case", "Aa", "caseSensitive"))
          .child(opt("regex", ".*", "regex"))
          .child(div().w(80).text_size(11).text_color(this.findError ? t.blocked : t.dim).child(this.findError ? "error" : `${n}${n >= 1000 ? "+" : ""} match${n === 1 ? "" : "es"}`))
          .child(this.button(t, "find-replace-toggle", this.replaceOpen ? "Hide replace" : "Replace…", (_e, cx) => {
            this.replaceOpen = !this.replaceOpen;
            cx.notify();
          }))
          .child(this.button(t, "find-close", "×", (_e, cx) => {
            this.findOpen = false;
            cx.notify();
          })),
      )
      .when(Boolean(this.replaceOpen) && !tab?.notice && !tab?.compare, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .child(input(this.find.with))
            .child(this.button(t, "replace-one", "Replace next", (_e, cx) => this.replaceOne(cx)))
            .child(this.button(t, "replace-all", "Replace all", (_e, cx) => this.replaceEvery(cx)))
            .when(this.undoText != null, (el) => el.child(this.button(t, "replace-undo", "Undo replace", (_e, cx) => this.undoReplace(cx)))),
        ),
      )
      .when(Boolean(this.findError || this.findNote), (el) =>
        el.child(div().text_size(11).text_color(this.findError ? t.blocked : t.muted).child(this.findError ?? this.findNote)),
      )
      .when(n > 0, (el) =>
        el.child(
          v_flex()
            .id("matches")
            .max_h(120)
            .overflow_y_scrollbar()
            .children(
              this.matches.slice(0, 200).map((m, i) =>
                h_flex()
                  .id(`m-${i}`)
                  .gap(8)
                  .text_size(11)
                  .child(div().w(54).flex_none().text_color(t.dim).child(`${m.line}:${m.col}`))
                  .child(div().flex_1().truncate().text_color(t.muted).child(m.text.trim())),
              ),
            ),
        ),
      );
  }

  // Reload what changed on disk: silently if you haven't edited it, else flag a conflict.
  async poll(cx) {
    for (const tab of this.tabs) {
      if (tab.notice || tab.compare) continue;
      const info = await fileInfo(tab.path);
      if (!info || info.mtime === tab.mtime) continue;
      tab.mtime = info.mtime;
      const disk = (await readTextFile(tab.path)) ?? "";
      if (disk === tab.original) continue;
      const who = await whoChanged(tab.path);
      if (!tab.dirty) {
        tab.original = disk;
        tab.state.set_value(disk);
        tab.dirty = false;
        tab.flash = `Reloaded: changed on disk${who ? ` by ${who}` : ""}.`;
      } else tab.conflict = { disk, who };
      cx.notify();
    }
  }

  async save(cx, tab) {
    if (!tab || tab.notice || tab.compare) return;
    const text = tab.state.value();
    try {
      await writeTextFile(tab.path, text, tab.original);
      tab.original = text;
      tab.dirty = false;
      tab.conflict = null;
      tab.mtime = (await fileInfo(tab.path))?.mtime ?? tab.mtime;
      tab.flash = "Saved.";
    } catch {
      // Changed since it was opened: never overwrite unseen.
      const disk = (await readTextFile(tab.path)) ?? "";
      tab.conflict = { disk, who: await whoChanged(tab.path) };
    }
    cx.notify();
  }

  reload(cx, tab) {
    tab.original = tab.conflict?.disk ?? tab.original;
    tab.state.set_value(tab.original);
    tab.dirty = false;
    tab.conflict = null;
    tab.flash = "Reloaded from disk; your edits are gone.";
    cx.notify();
  }

  async overwrite(cx, tab) {
    // Save over what's on disk now, knowingly.
    tab.original = tab.conflict.disk;
    tab.conflict = null;
    await this.save(cx, tab);
  }

  // A diff of disk (what's there) against yours, in its own tab.
  async compare(cx, tab) {
    const dir = `${appHome()}/data/trailboss`;
    await exec("mkdir", ["-p", dir]);
    const mine = `${dir}/compare-${Date.now()}`;
    await writeTextFile(mine, tab.state.value(), null);
    const r = await exec("diff", ["-u", "--label", `on disk: ${nameOf(tab.path)}`, "--label", "yours", tab.path, mine]);
    await exec("rm", ["-f", "--", mine]);
    this.tabs.push({
      path: `${tab.path} (compare)`,
      compare: true,
      dirty: false,
      notice: null,
      state: EditorState.new({ language: "diff", value: r.stdout || "No differences.", readonly: true, font_family: settings().font_family, syntax: this.syntax() }),
    });
    this.active = this.tabs.length - 1;
    cx.notify();
  }

  close(cx, i, force) {
    const tab = this.tabs[i];
    if (tab?.dirty && !force) {
      this.closing = i;
      this.active = i;
      return cx.notify();
    }
    this.closing = null;
    tab?.state?.release?.();
    this.tabs.splice(i, 1);
    this.active = Math.min(this.active, this.tabs.length - 1);
    cx.notify();
  }

  keys(e, cx) {
    const k = e.keystroke;
    const tab = this.tabs[this.active];
    if (k === "ctrl-s" || k === "cmd-s") {
      cx.spawn((cx) => this.save(cx, tab));
      cx.stop_propagation();
    } else if (k === "ctrl-w" || k === "cmd-w") {
      if (tab) this.close(cx, this.active);
      cx.stop_propagation();
    } else if (k === "ctrl-f" || k === "cmd-f") {
      this.openFind(cx, false);
      cx.stop_propagation();
    } else if (k === "ctrl-h" || k === "cmd-alt-f") {
      this.openFind(cx, true);
      cx.stop_propagation();
    } else if (k === "alt-z") {
      this.toggleWrap(cx);
      cx.stop_propagation();
    } else if (k === "escape" && this.findOpen) {
      this.findOpen = false;
      cx.notify();
      cx.stop_propagation();
    } else if (k === "ctrl-tab" && this.tabs.length) {
      this.active = (this.active + 1) % this.tabs.length;
      cx.notify();
      cx.stop_propagation();
    }
  }

  button(t, id, label, onClick, strong) {
    return div()
      .id(id)
      .cursor_pointer()
      .px(8)
      .py(1)
      .rounded(4)
      .text_size(11.5)
      .bg(strong ? t.solid : t.raised)
      .text_color(strong ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85))
      .on_click(onClick)
      .child(label);
  }

  render() {
    const t = theme();
    const tab = this.tabs[this.active];
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.background)
      .text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.keys(e, cx))
      .child(
        h_flex()
          .id("tabs")
          .h(32)
          .flex_none()
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .overflow_x_scrollbar()
          .children(
            this.tabs.map((x, i) =>
              h_flex()
                .id(`tab-${i}`)
                .h_full()
                .px(10)
                .gap(6)
                .items_center()
                .cursor_pointer()
                .border_r(1)
                .border_color(t.border)
                .bg(i === this.active ? t.background : t.chrome)
                .on_click((_e, cx) => {
                  this.active = i;
                  cx.notify();
                })
                .child(div().text_size(12).text_color(i === this.active ? t.foreground : t.muted).child(nameOf(x.path)))
                .when(Boolean(x.conflict), (el) => el.child(div().text_size(11).text_color(t.blocked).child("!")))
                .child(
                  div()
                    .id(`x-${i}`)
                    .px(2)
                    .text_size(12)
                    .text_color(x.dirty ? t.working : t.dim)
                    .hover((s) => s.text_color(t.foreground))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      this.close(cx, i);
                    })
                    .child(x.dirty ? "●" : "×"),
                ),
            ),
          ),
      )
      .when(Boolean(this.findOpen && this.find && tab), (el) => el.child(this.findBar(t)))
      .when(this.closing !== null && this.tabs[this.closing], (el) =>
        el.child(
          h_flex()
            .px(10)
            .py(5)
            .gap(8)
            .items_center()
            .bg(t.raised)
            .child(div().flex_1().text_size(12).child(`${nameOf(this.tabs[this.closing].path)} has unsaved changes.`))
            .child(this.button(t, "save-close", "Save and close", (_e, cx) => cx.spawn(async (cx) => {
              const i = this.closing;
              await this.save(cx, this.tabs[i]);
              if (!this.tabs[i]?.dirty) this.close(cx, i, true);
            }), true))
            .child(this.button(t, "discard-close", "Close without saving", (_e, cx) => this.close(cx, this.closing, true)))
            .child(this.button(t, "keep-open", "Cancel", (_e, cx) => {
              this.closing = null;
              cx.notify();
            })),
        ),
      )
      .when(Boolean(tab?.conflict), (el) =>
        el.child(
          v_flex()
            .px(10)
            .py(6)
            .gap(4)
            .bg(t.raised)
            .border_b(1)
            .border_color(t.blocked)
            .child(
              div()
                .text_size(12)
                .text_color(t.blocked)
                .child(`Changed on disk${tab.conflict.who ? ` by ${tab.conflict.who}` : ""} since you opened it. Your edits aren't saved.`),
            )
            .child(
              h_flex()
                .gap(6)
                .child(this.button(t, "c-compare", "Compare", (_e, cx) => cx.spawn((cx) => this.compare(cx, tab))))
                .child(this.button(t, "c-reload", "Reload (drop my edits)", (_e, cx) => this.reload(cx, tab)))
                .child(this.button(t, "c-overwrite", "Overwrite with mine", (_e, cx) => cx.spawn((cx) => this.overwrite(cx, tab)))),
            ),
        ),
      )
      .when(Boolean(tab?.notice), (el) => el.child(div().px(10).py(6).text_size(12).text_color(t.muted).child(tab.notice)))
      .child(
        div()
          .flex_1()
          .min_h(0)
          .when(Boolean(tab && !tab.notice), (el) => el.child(Editor.new(tab.state)))
          .when(!tab, (el) =>
            el.child(
              div()
                .p(20)
                .text_size(12.5)
                .text_color(t.dim)
                .child("Open a file from the Trailboss Files panel. Ctrl+S saves, Ctrl+W closes, Ctrl+Tab switches."),
            ),
          ),
      )
      .when(Boolean(tab), (el) =>
        el.child(
          h_flex()
            .h(24)
            .flex_none()
            .px(10)
            .gap(10)
            .items_center()
            .border_t(1)
            .border_color(t.border)
            .bg(t.chrome)
            .text_size(11)
            .text_color(t.dim)
            .child(div().flex_1().truncate().child(tab.path))
            .when(Boolean(tab.flash), (el) => el.child(div().text_color(t.muted).child(tab.flash)))
            .child(tab.compare ? "diff" : langOf(tab.path))
            .when(!tab.compare, (el) =>
              el
                .child(this.button(t, "find-open", "Find", (_e, cx) => this.openFind(cx, false)))
                .child(this.button(t, "wrap", tab.wrap ? "Wrap: on" : "Wrap: off", (_e, cx) => this.toggleWrap(cx))),
            )
            .child(tab.compare ? "compare" : tab.dirty ? "unsaved" : "saved")
            .when(!tab.compare && !tab.notice, (el) =>
              el.child(this.button(t, "save", "Save", (_e, cx) => cx.spawn((cx) => this.save(cx, tab)), tab.dirty)),
            ),
        ),
      );
  }
}
