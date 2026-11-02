import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, run, spaces, panes, focused, watchFolder, notify, setShared, openOverlay, closeOverlay } from "herdr";
import { tb, err, short } from "../lib.js";
import { parentOf, inside, within, dropDest } from "./paths.js";

// Files for the folder you're working in, aware of agents: each changed file is badged with
// the agent that changed it (exactly, from its edit tool, or probably, from when it changed
// and who was working there), from `trailboss changes --worktree`. Create, rename, move and
// trash files; open them in the Trailboss editor. Local folders only (v1).

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

// Opens a file in the editor pane of this tab, starting one beside the focused pane if
// there isn't one yet. The editor picks the request up from shared state.
export function openInEditor(path) {
  setShared(OPEN_KEY, { path, at: Date.now() });
  const tab = focused()?.tab;
  if (!panes().some((p) => p.mod === "trailboss" && p.tab === tab)) {
    run("pane.split", { direction: "right", mod: "trailboss", props: { view: "editor" } });
  }
}

// The file operations, shared by the panel, its context menu and dragging. Each refuses
// to overwrite anything that exists, and keeps paths inside `root`.

export const createFile = (path) => sh('mkdir -p -- "$(dirname -- "$1")" && set -C && : > "$1"', path); // noclobber
export const createFolder = (path) => exec("mkdir", ["-p", "--", path]);
export const movePath = (from, to) =>
  sh('[ ! -e "$2" ] || { echo "$2 already exists" >&2; exit 1; }; mkdir -p -- "$(dirname -- "$2")" && mv -n -- "$1" "$2"', from, to);

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
    const norm = within(this.root, kind === "rename" ? this.root : at, name);
    if (!norm) {
      notify({ title: "Stays inside this folder", body: name, level: "warning" });
      return cx.notify();
    }
    const r = kind === "new-folder" ? await createFolder(norm) : kind === "new-file" ? await createFile(norm) : await movePath(at, norm);
    if (r.code !== 0) notify({ title: "Couldn't do that", body: (r.stderr || r.stdout).trim(), level: "error" });
    else {
      this.open.add(parentOf(norm));
      this.selected = norm;
      if (kind === "new-file") openInEditor(norm);
    }
    for (const d of [...this.open]) await this.load(cx, d);
  }

  // The right-click menu, at the pointer.
  menu(path, isDir) {
    const items = isDir ? 8 : 9;
    openOverlay({
      mod: "trailboss",
      props: { view: "files-menu", path, dir: isDir, root: this.root },
      kind: "popup",
      width: 230,
      height: 34 + items * 27,
    });
  }

  async drop(cx, to) {
    const from = this.drag?.path;
    this.drag = null;
    this.dropOn = null;
    this.dragged = true;
    if (!from || !to) return cx.notify();
    const name = from.split("/").pop();
    const dest = dropDest(this.root, from, to); // null: not a move
    if (!dest) return cx.notify();
    const r = await movePath(from, dest);
    if (r.code !== 0) notify({ title: `Couldn't move ${name}`, body: (r.stderr || "").trim(), level: "error" });
    else {
      notify({ title: `Moved ${name}`, body: `to ${to.slice(this.root.length) || "/"}`, level: "info", timeout: 2500 });
      this.open.add(to);
      this.selected = dest;
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
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation(); // the tree's own right-click is the top folder's menu
            this.selected = path;
            this.menu(path, e.dir);
            cx.notify();
          })
          // Dragging: press, move a few pixels, release on a folder (or a file: its folder).
          .on_mouse_down("left", (ev) => {
            this.drag = { path, x: ev.position.x, y: ev.position.y, moved: false };
          })
          .on_hover((over, cx) => {
            if (over && this.drag?.moved) {
              this.dropOn = e.dir ? path : dir;
              cx.notify();
            }
          })
          .on_mouse_up("left", (_ev, cx) => {
            if (this.drag?.moved) {
              cx.stop_propagation();
              cx.spawn((cx) => this.drop(cx, e.dir ? path : dir));
            }
          })
          .when(Boolean(this.drag?.moved) && this.dropOn === path, (el) => el.border_1().border_color(t.accent))
          .on_click((_e, cx) => {
            // The click that ends a drag isn't a click.
            if (this.dragged) {
              this.dragged = false;
              return;
            }
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
          : "Changed; not by an agent Trailboss saw"
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
      .child(
        v_flex()
          .id("tree")
          .flex_1()
          .min_h(0)
          .px(4)
          .pb(6)
          .overflow_y_scrollbar()
          .on_mouse_move((ev, cx) => {
            const d = this.drag;
            if (d && !d.moved && Math.abs(ev.position.x - d.x) + Math.abs(ev.position.y - d.y) > 5) {
              d.moved = true;
              cx.notify();
            }
          })
          .on_mouse_up("left", (_ev, cx) => {
            // Released on empty space: the folder shown. Elsewhere, a plain click ended.
            if (this.drag?.moved) cx.spawn((cx) => this.drop(cx, this.dropOn ?? this.root));
            else this.drag = null;
          })
          .on_mouse_down("right", () => {
            if (this.root) this.menu(this.root, true);
          })
          .children(rows),
      )
      .when(Boolean(this.drag?.moved), (el) =>
        el.child(
          div()
            .px(10)
            .py(4)
            .text_size(11)
            .text_color(t.accent)
            .child(`Move ${this.drag.path.split("/").pop()} to ${(this.dropOn ?? this.root).slice(this.root.length) || "/"}`),
        ),
      )
      .when(Boolean(this.footer(t)), (el) => el.child(this.footer(t)));
  }
}

// The right-click menu for a file or folder: open, add, rename or move, copy the path,
// reveal, move to the trash. It works on its own; the panel sees the result through its
// folder watch.
export class FilesMenu {
  init(p) {
    this.p = p;
    this.overlay = p.overlay;
    this.input = null; // { kind, state }
    this.confirm = false;
    this.error = null;
  }

  close() {
    closeOverlay(this.overlay);
  }

  ask(kind, cx) {
    const { path, root } = this.p;
    const value = kind === "rename" ? path.slice(root.length + 1) : "";
    const state = InputState.new({ placeholder: kind === "rename" ? "new path" : kind === "folder" ? "folder name" : "file name", value });
    state.on("submit", (_e, cx) => cx.spawn((cx) => this.done(cx, kind, state.value().trim())));
    this.input = { kind, state };
    state.focus();
    cx.notify();
  }

  async done(cx, kind, name) {
    const { path, root, dir } = this.p;
    if (!name) return this.close();
    const base = kind === "rename" ? root : dir ? path : parentOf(path);
    const dest = within(root, base, name);
    if (!dest) {
      this.error = "Stays inside this folder.";
      return cx.notify();
    }
    const r = kind === "folder" ? await createFolder(dest) : kind === "file" ? await createFile(dest) : await movePath(path, dest);
    if (r.code !== 0) {
      this.error = (r.stderr || "Couldn't do that.").trim();
      return cx.notify();
    }
    if (kind === "file") openInEditor(dest);
    this.close();
  }

  async trash(cx) {
    const r = await trashPath(this.p.path);
    if (r.code !== 0) {
      this.error = (r.stderr || "").trim();
      return cx.notify();
    }
    notify({ title: "Moved to trash", body: this.p.path, level: "info", timeout: 3000 });
    this.close();
  }

  item(t, id, label, onClick, danger) {
    return div()
      .id(id)
      .px(10)
      .py(4)
      .rounded(4)
      .text_size(12.5)
      .cursor_pointer()
      .text_color(danger ? t.blocked : t.foreground)
      .hover((s) => s.bg(t.hover))
      .on_click(onClick)
      .child(label);
  }

  render() {
    const t = theme();
    const { path, root, dir } = this.p;
    const isRoot = path === root;
    const name = path.split("/").pop();
    const items = [];
    if (this.input) {
      items.push(
        div().px(6).py(4).child(Input.new(this.input.state).h(26).px(6).rounded(4).border_1().border_color(t.accent).bg(t.background).text_size(12)),
        div().px(10).text_size(10.5).text_color(t.dim).child("Enter to confirm, Esc to cancel"),
      );
    } else {
      if (!dir) items.push(this.item(t, "open", "Open", () => (openInEditor(path), this.close())));
      items.push(
        this.item(t, "new-file", "New file…", (_e, cx) => this.ask("file", cx)),
        this.item(t, "new-folder", "New folder…", (_e, cx) => this.ask("folder", cx)),
      );
      if (!isRoot) items.push(this.item(t, "rename", "Rename / move…", (_e, cx) => this.ask("rename", cx)));
      items.push(
        this.item(t, "copy-name", "Copy name", () => copyText(name).then(() => this.close())),
        this.item(t, "copy", "Copy full path", () => copyText(path).then(() => this.close())),
        this.item(t, "copy-rel", "Copy relative path", () => copyText(isRoot ? "." : path.slice(root.length + 1)).then(() => this.close())),
        this.item(t, "reveal", "Reveal in file manager", () => (exec("xdg-open", [dir ? path : parentOf(path)]), this.close())),
      );
      if (!isRoot)
        items.push(
          this.confirm
            ? this.item(t, "trash-yes", `Move ${short(name, 18)} to trash?`, (_e, cx) => cx.spawn((cx) => this.trash(cx)), true)
            : this.item(t, "trash", "Move to trash", (_e, cx) => {
                this.confirm = true;
                cx.notify();
              }, true),
        );
    }
    return v_flex()
      .id("root")
      .size_full()
      .p(4)
      .gap(1)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(div().px(10).py(3).truncate().text_size(10.5).text_color(t.dim).child(isRoot ? name || path : path.slice(root.length + 1)))
      .children(items)
      .when(Boolean(this.error), (el) => el.child(div().px(10).py(3).text_size(11).text_color(t.blocked).child(short(this.error, 120))));
  }
}

// Copy text to the clipboard (Wayland, else X11).
function copyText(text) {
  return exec("sh", ["-c", 'printf %s "$1" | wl-copy 2>/dev/null || printf %s "$1" | xclip -selection clipboard', "sh", text]);
}
