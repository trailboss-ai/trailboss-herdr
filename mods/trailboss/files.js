import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, run, spaces, panes, focused, watchFolder, notify, setShared } from "herdr";
import { tb, err, short } from "./lib.js";

// Files for the folder you're working in, aware of agents: each changed file is badged with
// the agent that changed it (exactly, from its edit tool, or probably, from when it changed
// and who was working there), from `trailboss changes --worktree`. Create, rename, move and
// trash files; open them in the trailboss editor. Local folders only (v1).

const PER_FOLDER = 500;
const ATTRIBUTE_MS = 15000;
export const OPEN_KEY = "trailboss.editor.open";

const AGENT_COLORS = { claude: "#d4704f", codex: "#3f86e0", opencode: "#8f6fe0", pi: "#3fb27f" };
const agentColor = (t, a) => AGENT_COLORS[a] ?? t.accent;
const STATUS_COLORS = (t) => ({ M: t.working, A: t.done, "??": t.done, D: t.blocked, R: t.accent });

// The folder to show: the focused pane's, else the active space's.
export function here() {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return pane?.cwd || f?.cwd || spaces().find((s) => s.active)?.folder || null;
}

async function list(dir) {
  const r = await exec("find", [dir, "-mindepth", "1", "-maxdepth", "1", "-not", "-name", ".git", "-printf", "%y\t%f\n"]);
  if (r.code !== 0) throw new Error((r.stderr || "can't list this folder").trim());
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, PER_FOLDER)
    .map((l) => {
      const [kind, ...name] = l.split("\t");
      return { name: name.join("\t"), dir: kind === "d" };
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

const sh = (script, ...args) => exec("sh", ["-c", script, "sh", ...args]);
const parentOf = (p) => p.replace(/\/[^/]+$/, "") || "/";
const inside = (root, p) => p === root || p.startsWith(`${root}/`);

// Opens a file in the editor pane of this tab, starting one beside the focused pane if
// there isn't one yet. The editor picks the request up from shared state.
export function openInEditor(path) {
  setShared(OPEN_KEY, { path, at: Date.now() });
  const tab = focused()?.tab;
  if (!panes().some((p) => p.mod === "trailboss" && p.tab === tab)) {
    run("pane.split", { direction: "right", mod: "trailboss", props: { view: "editor" } });
  }
}

// Trash, never delete: gio (most desktops), else trash-cli.
export function trashPath(path) {
  // Each tool may refuse (gio won't trash on system mounts like /tmp); then try the next.
  // Nothing is ever deleted outright.
  return sh(
    'if command -v gio >/dev/null && gio trash -- "$1"; then exit 0; fi; ' +
      'if command -v trash-put >/dev/null && trash-put -- "$1"; then exit 0; fi; ' +
      'echo "Couldn\'t move it to the trash here (install gio or trash-cli); nothing was deleted." >&2; exit 1',
    path,
  );
}

export class Files {
  init(_p, cx) {
    this.root = null;
    this.entries = new Map(); // folder → its listing
    this.open = new Set(); // expanded folders
    this.marks = new Map(); // absolute path → attribution row
    this.selected = null;
    this.error = null;
    this.prompt = null; // { kind: "new-file" | "new-folder" | "rename", at, input }
    this.confirmTrash = null;
    cx.timer.every(1500, (cx) => cx.spawn((cx) => this.follow(cx)));
    cx.timer.every(ATTRIBUTE_MS, (cx) => cx.spawn((cx) => this.attribute(cx)));
    cx.spawn((cx) => this.follow(cx));
  }

  // Follow the focused pane: show its repository (or folder).
  async follow(cx) {
    const cwd = here();
    if (!cwd || cwd === this.cwd) return;
    this.cwd = cwd;
    const top = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]).catch(() => null);
    const root = top?.code === 0 ? top.stdout.trim() : cwd;
    if (root === this.root) return;
    this.root = root;
    this.git = top?.code === 0;
    this.entries.clear();
    this.open = new Set([root]);
    this.selected = null;
    this.marks.clear();
    await this.load(cx, root);
    this.attribute(cx);
    this.watch(cx, root);
  }

  watch(cx, root) {
    cx.spawn(async (cx) => {
      while (this.root === root) {
        try {
          await watchFolder(root);
        } catch {
          return;
        }
        if (this.root !== root) return;
        for (const d of [...this.open]) await this.load(cx, d);
        this.attribute(cx);
      }
    });
  }

  async load(cx, dir) {
    try {
      this.entries.set(dir, await list(dir));
      this.error = null;
    } catch (e) {
      this.error = err(e);
    }
    cx.notify();
  }

  async attribute(cx) {
    if (!this.git || this.attributing) return;
    this.attributing = true;
    try {
      const rows = await tb(["changes", "--worktree", this.root]);
      this.marks = new Map(rows.map((r) => [r.abs, r]));
    } catch {}
    this.attributing = false;
    cx.notify();
  }

  // Where a new file or folder goes: the selected folder, or the selected file's folder.
  target() {
    if (!this.selected) return this.root;
    const e = this.isDir(this.selected);
    return e ? this.selected : parentOf(this.selected);
  }

  isDir(path) {
    if (path === this.root) return true;
    return (this.entries.get(parentOf(path)) ?? []).some((e) => e.dir && `${parentOf(path)}/${e.name}` === path);
  }

  ask(cx, kind) {
    const at = kind === "rename" ? this.selected : this.target();
    if (!at || (kind === "rename" && at === this.root)) return;
    const value = kind === "rename" ? at.slice(this.root.length + 1) : "";
    const input = InputState.new({ placeholder: kind === "new-folder" ? "folder name" : kind === "new-file" ? "file name" : "new path", value });
    input.on("submit", (_e, cx) => cx.spawn((cx) => this.finish(cx, kind, at, input.value().trim())));
    this.prompt = { kind, at, input };
    input.focus();
    cx.notify();
  }

  async finish(cx, kind, at, name) {
    this.prompt = null;
    if (!name) return cx.notify();
    // Names and moves stay inside the folder shown.
    const dest = kind === "rename" ? `${this.root}/${name}` : `${at}/${name}`;
    const norm = dest.replace(/\/\.\//g, "/");
    if (norm.includes("/../") || norm.endsWith("/..") || !inside(this.root, norm)) {
      notify({ title: "Stays inside this folder", body: name, level: "warning" });
      return cx.notify();
    }
    let r;
    if (kind === "new-folder") r = await exec("mkdir", ["-p", "--", norm]);
    // noclobber: never overwrite an existing file.
    else if (kind === "new-file") r = await sh('mkdir -p -- "$(dirname -- "$1")" && set -C && : > "$1"', norm);
    else r = await sh('[ ! -e "$2" ] || { echo "$2 already exists" >&2; exit 1; }; mkdir -p -- "$(dirname -- "$2")" && mv -n -- "$1" "$2"', at, norm);
    if (r.code !== 0) notify({ title: "Couldn't do that", body: (r.stderr || r.stdout).trim(), level: "error" });
    else {
      this.open.add(parentOf(norm));
      this.selected = norm;
      if (kind === "new-file") openInEditor(norm);
    }
    for (const d of [...this.open]) await this.load(cx, d);
  }

  async trash(cx, path) {
    this.confirmTrash = null;
    const r = await trashPath(path);
    if (r.code !== 0) notify({ title: "Couldn't move to trash", body: (r.stderr || "").trim(), level: "error" });
    else {
      notify({ title: "Moved to trash", body: path, level: "info", timeout: 3000 });
      this.selected = null;
    }
    for (const d of [...this.open]) await this.load(cx, d);
  }

  badge(t, mark) {
    if (!mark?.agent) return null;
    const c = agentColor(t, mark.agent);
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

  rows(t, dir, depth, out) {
    for (const e of this.entries.get(dir) ?? []) {
      const path = `${dir}/${e.name}`;
      const mark = this.marks.get(path);
      const changedInside = e.dir && [...this.marks.keys()].some((p) => p.startsWith(`${path}/`));
      const open = this.open.has(path);
      const sel = this.selected === path;
      const status = mark?.status;
      out.push(
        h_flex()
          .id(`f-${path}`)
          .pl(8 + depth * 14)
          .pr(8)
          .py(2)
          .gap(6)
          .items_center()
          .rounded(4)
          .cursor_pointer()
          .when(sel, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.selected = path;
            this.confirmTrash = null;
            if (e.dir) {
              if (open) this.open.delete(path);
              else {
                this.open.add(path);
                cx.spawn((cx) => this.load(cx, path));
              }
            } else openInEditor(path);
            cx.notify();
          })
          .child(div().w(10).text_size(10).text_color(t.dim).child(e.dir ? (open ? "▾" : "▸") : ""))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(status ? STATUS_COLORS(t)[status] ?? t.foreground : t.foreground).child(e.name))
          .when(changedInside, (el) => el.child(div().w(6).h(6).rounded(3).bg(t.working)))
          .when(Boolean(status), (el) => el.child(div().text_size(10).text_color(STATUS_COLORS(t)[status] ?? t.muted).child(status)))
          .when(Boolean(this.badge(t, mark)), (el) => el.child(this.badge(t, mark))),
      );
      if (this.prompt && this.prompt.kind !== "rename" && this.prompt.at === path) out.push(this.promptRow(t, depth + 1));
      if (e.dir && open) this.rows(t, path, depth + 1, out);
    }
  }

  promptRow(t, depth) {
    return h_flex()
      .pl(8 + depth * 14)
      .pr(8)
      .py(2)
      .child(Input.new(this.prompt.input).flex_1().h(24).px(6).rounded(4).border_1().border_color(t.accent).bg(t.background).text_size(12));
  }

  tool(t, id, label, onClick, enabled = true) {
    return div()
      .id(id)
      .px(6)
      .py(1)
      .rounded(4)
      .text_size(11.5)
      .text_color(enabled ? t.muted : t.dim)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick))
      .child(label);
  }

  footer(t) {
    const p = this.selected;
    if (!p) return null;
    const m = this.marks.get(p);
    const line = m?.agent
      ? `${m.how === "exact" ? "Changed by" : "Probably changed by"} ${m.agent}${m.title ? ` · ${short(m.title, 60)}` : ""}${m.ts ? ` · ${new Date(m.ts).toLocaleString()}` : ""}`
      : m
        ? m.candidates
          ? `Changed; ${m.candidates} agent sessions were working here then`
          : "Changed; not by an agent trailboss saw"
        : null;
    return v_flex()
      .px(10)
      .py(6)
      .gap(2)
      .border_t(1)
      .border_color(t.border)
      .child(div().truncate().text_size(11).text_color(t.muted).child(p.slice((this.root?.length ?? 0) + 1) || p))
      .when(Boolean(line), (el) => el.child(div().text_size(11).text_color(m?.agent ? agentColor(t, m.agent) : t.dim).child(line)));
  }

  render() {
    const t = theme();
    const rows = [];
    if (this.root) {
      if (this.prompt && this.prompt.kind !== "rename" && this.prompt.at === this.root) rows.push(this.promptRow(t, 0));
      this.rows(t, this.root, 0, rows);
    }
    const sel = this.selected;
    const canTrash = Boolean(sel) && sel !== this.root;
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
          .child(div().text_size(13).font_semibold().child("Files"))
          .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(this.root ? this.root.split("/").pop() : ""))
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
      .child(
        h_flex()
          .px(8)
          .pb(6)
          .gap(2)
          .flex_none()
          .flex_wrap()
          .child(this.tool(t, "new-file", "+ File", (_e, cx) => this.ask(cx, "new-file"), Boolean(this.root)))
          .child(this.tool(t, "new-folder", "+ Folder", (_e, cx) => this.ask(cx, "new-folder"), Boolean(this.root)))
          .child(this.tool(t, "rename", "Rename / move", (_e, cx) => this.ask(cx, "rename"), canTrash))
          .when(this.confirmTrash !== sel || !canTrash, (el) =>
            el.child(
              this.tool(t, "trash", "Trash", (_e, cx) => {
                this.confirmTrash = sel;
                cx.notify();
              }, canTrash),
            ),
          )
          .when(canTrash && this.confirmTrash === sel, (el) =>
            el
              .child(
                div()
                  .id("trash-yes")
                  .cursor_pointer()
                  .px(6)
                  .py(1)
                  .rounded(4)
                  .text_size(11.5)
                  .bg(t.blocked)
                  .text_color(t.background)
                  .on_click((_e, cx) => cx.spawn((cx) => this.trash(cx, sel)))
                  .child("Move to trash?"),
              )
              .child(this.tool(t, "trash-no", "Keep", (_e, cx) => {
                this.confirmTrash = null;
                cx.notify();
              })),
          )
          .child(this.tool(t, "reveal", "Reveal", () => exec("xdg-open", [sel ? (this.isDir(sel) ? sel : parentOf(sel)) : this.root]), Boolean(this.root))),
      )
      .when(Boolean(this.prompt?.kind === "rename"), (el) =>
        el.child(h_flex().px(8).pb(6).child(Input.new(this.prompt.input).flex_1().h(24).px(6).rounded(4).border_1().border_color(t.accent).bg(t.background).text_size(12))),
      )
      .when(Boolean(this.error), (el) => el.child(div().px(12).pb(6).text_size(11).text_color(t.blocked).child(this.error)))
      .when(!this.root, (el) => el.child(div().px(12).text_size(12).text_color(t.dim).child("Focus a terminal to see its folder.")))
      .child(v_flex().id("tree").flex_1().min_h(0).px(4).pb(6).overflow_y_scrollbar().children(rows))
      .when(Boolean(this.footer(t)), (el) => el.child(this.footer(t)));
  }
}
