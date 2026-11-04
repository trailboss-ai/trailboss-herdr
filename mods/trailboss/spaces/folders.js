// The spaces sidebar with folders (#46): Herdr's own spaces list (base.js, unchanged) plus
// folders up to four deep. Spaces go in a folder by hand (drag one onto it) or by its rules;
// `trailboss folders` keeps the tree and decides where each space goes, so every frontend
// agrees. Herdr's order follows the list, so its next / previous space keys go down it.
//
// Herdr's spaces mod is Apache-2.0 (LICENSE-APACHE here); `ordered`, `where` and `place`
// below follow base.js. Everything else is Trailboss's.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, machines, run, theme, shared, setShared, openOverlay, closeOverlay, notify, focused } from "herdr";
import Spaces from "./base.js";
import { tb, short, err } from "../lib.js";
import { layoutTree, spaceOrder, canMoveInto } from "./tree.js";

export const STATE = "trailboss.folders"; // the last `trailboss --json folders`, for every view
export const FOCUS = "trailboss.focus"; // a folder id shown alone, or null
const PENDING = "trailboss.folders.pending"; // {folder, before, at}: file the next new space there
const INDENT = 14;
const NEW_SPACE_WAIT = 15000; // how long a space made from a folder's + is waited for
// Herdr's avatar colors (base.js's MARK, which it doesn't export).
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const COLORS = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6"];

// From base.js: where a space is now (its first terminal's folder, else where it was made).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);

// Runs a `trailboss folders` action; every view sees the new tree through shared state.
export async function folders(args = []) {
  const state = await tb(["folders", ...args]);
  setShared(STATE, state);
  return state;
}

export class FolderSpaces extends Spaces {
  init(props, cx) {
    super.init(props, cx);
    this.placed = {}; // space id -> folder id (null: top level), from `folders place`
    this.placeKey = null;
    this.placing = false;
    this.dragSpace = null; // a space being dragged (Herdr's row tracks its own drag too)
    this.dragFolder = null;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        await folders();
      } catch (e) {
        this.error = err(e);
      }
      cx.notify();
    });
  }

  // Herdr's look for new spaces, plus: place spaces whenever where they are changes, and
  // file a space made from a folder's + in that folder.
  checkNew(cx) {
    super.checkNew(cx);
    const ps = panes();
    const sp = spaces();
    const input = sp.map((s) => ({ id: s.id, cwd: place(s, ps) || null, machine: s.machine ?? null }));
    const key = JSON.stringify([input, shared(STATE)]);
    if (key !== this.placeKey && !this.placing) {
      this.placing = true;
      cx.spawn(async (cx) => {
        try {
          const rows = await tb(["folders", "place", "--spaces", JSON.stringify(input)]);
          this.placed = Object.fromEntries(rows.map((r) => [r.id, r.folder]));
          this.placeKey = key;
        } catch (e) {
          this.error = err(e);
          this.placeKey = key; // don't retry every 250 ms; the next change does
        }
        this.placing = false;
        cx.notify();
      });
    }
    const pending = shared(PENDING);
    if (pending) {
      const before = new Set(pending.before);
      const made = sp.find((s) => !before.has(s.id));
      if (made || Date.now() - pending.at > NEW_SPACE_WAIT) setShared(PENDING, null);
      if (made) cx.spawn(async () => folders(["file", made.id, pending.folder]).catch(() => {}));
    }
  }

  // From base.js, with one change: the target order is the sidebar's, folders first.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placedRepos = new Set();
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placedRepos.has(r.g.repo)) continue;
      placedRepos.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    const sorted = spaceOrder(out, shared(STATE), this.placed);
    const order = sp.map((w) => w.id);
    const target = sorted.map((r) => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < sorted.length; i++) {
        const from = order.indexOf(sorted[i].w.id);
        if (from === i) continue;
        run("space.move", { id: sorted[i].w.id, index: i + 1 });
        moved.add(sorted[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    const shown = sorted.filter((r) => this.shown.has(r.w.id));
    return this.only ? shown.filter((r) => this.only.has(r.w.id)) : shown;
  }

  // Folders first, then Herdr's own grouping for the spaces in none.
  grouped(t, collapsed) {
    const state = shared(STATE);
    if (collapsed || !state?.folders?.length) return super.grouped(t, collapsed);
    const focus = shared(FOCUS) ?? null;
    const { items, rest } = layoutTree(this.ordered(), state, this.placed, focus);
    const out = items.map((x) => (x.kind === "folder" ? this.folderRow(x, t) : this.filedRow(x, t)));
    if (this.dragSpace || this.dragFolder) out.push(this.topDrop(t));
    if (focus) return out;
    this.only = new Set(rest.map((r) => r.w.id));
    try {
      return [...out, ...(rest.length ? super.grouped(t, collapsed) : [])];
    } finally {
      this.only = null;
    }
  }

  // A space inside a folder: Herdr's row, indented; dropping a dragged space on it files the
  // dragged one in the same folder (Herdr's own handler moves it next to this one).
  filedRow(x, t) {
    const id = x.row.w.id;
    return div()
      .id(`filed-${id}`)
      .pl(x.depth * INDENT)
      .on_mouse_down("left", () => (this.dragSpace = id))
      .on_mouse_up("left", (_e, cx) => this.dropOn(cx, x.folder))
      .child(this.row(x.row, t));
  }

  dropOn(cx, folder) {
    const space = this.dragSpace;
    const moving = this.dragFolder;
    this.dragSpace = this.dragFolder = null;
    if (space && (this.placed[space] ?? null) !== folder) {
      cx.spawn(async (cx) => {
        await this.act(folder ? ["file", space, folder] : ["file", space, "--top"]);
        cx.notify();
      });
    } else if (moving && moving !== folder) {
      if (!canMoveInto(shared(STATE), moving, folder)) {
        notify({ title: "Folders go at most 4 levels deep", level: "warning", timeout: 4000 });
      } else {
        cx.spawn(async (cx) => {
          await this.act(folder ? ["move", moving, "--into", folder] : ["move", moving, "--top"]);
          cx.notify();
        });
      }
    }
    cx.notify();
  }

  async act(args) {
    try {
      await folders(args);
      this.error = null;
    } catch (e) {
      this.error = err(e);
    }
  }

  folderRow({ folder: f, depth, count, working, needs }, t) {
    const fill = MARK[f.color] ?? t.dim;
    const dropping = (this.dragSpace || (this.dragFolder && this.dragFolder !== f.id));
    return h_flex()
      .id(`folder-${f.id}`)
      .h(26)
      .flex_none()
      .pl(8 + depth * INDENT)
      .pr(6)
      .gap(7)
      .items_center()
      .rounded(7)
      .text_size(12.5)
      .cursor_pointer()
      .hover((s) => s.bg(dropping ? t.selected : t.hover))
      .when(this.dragFolder === f.id, (el) => el.opacity(0.5))
      .on_mouse_down("left", () => (this.dragFolder = f.id))
      .on_mouse_up("left", (_e, cx) => {
        if (this.dragFolder === f.id && !this.dragSpace) {
          this.dragFolder = null;
          cx.spawn(async (cx) => {
            await this.act(["edit", f.id, f.folded ? "--unfold" : "--fold"]);
            cx.notify();
          });
        } else this.dropOn(cx, f.id);
      })
      .on_mouse_down("right", () => openFolderMenu(f.id))
      .child(svg(`mods/workspace-chrome/chevron-${f.folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().size(10).rounded(3).flex_none().bg(fill))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(f.name))
      .when(working > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.working).child(`${working} working`)))
      .when(needs, (el) => el.child(div().flex_none().text_color(t.blocked).child("●")))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(String(count)))
      .child(
        div()
          .id(`folder-new-${f.id}`)
          .flex_none()
          .px(4)
          .rounded(4)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("New space here")
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.newSpaceIn(f);
          })
          .child("+"),
      );
  }

  newSpaceIn(f) {
    newSpaceIn(f);
  }

  topDrop(t) {
    return div()
      .id("folder-top")
      .h(26)
      .flex_none()
      .px(8)
      .rounded(7)
      .text_size(11.5)
      .text_color(t.dim)
      .border_1()
      .border_color(t.border)
      .hover((s) => s.bg(t.selected))
      .on_mouse_up("left", (_e, cx) => this.dropOn(cx, null))
      .child("Drop here for the top level");
  }

  // Herdr's header, plus New folder, and the focused folder's name with a way back.
  render() {
    const t = theme();
    const focus = shared(FOCUS) ?? null;
    const focused = focus && shared(STATE)?.folders?.find((f) => f.id === focus);
    const base = super.render();
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(
        h_flex()
          .h(26)
          .flex_none()
          .px(14)
          .gap(8)
          .items_center()
          .text_size(11.5)
          .text_color(t.dim)
          .when(Boolean(focused), (el) =>
            el
              .child(
                div()
                  .id("focus-back")
                  .cursor_pointer()
                  .hover((s) => s.text_color(t.foreground))
                  .on_click(() => setShared(FOCUS, null))
                  .child("← All spaces"),
              )
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(focused.name)),
          )
          .when(!focused, (el) => el.child(div().flex_1()))
          .child(
            div()
              .id("folder-add")
              .cursor_pointer()
              .px(4)
              .rounded(4)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => openFolderMenu(null, "new"))
              .child("New folder"),
          ),
      )
      .when(Boolean(this.error), (el) => el.child(div().px(14).text_size(11).text_color(t.blocked).child(short(this.error, 120))))
      .child(base.flex_1().min_h(0))
      .on_mouse_up("left", (_e, cx) => {
        this.dragSpace = this.dragFolder = null;
        cx.notify();
      });
  }
}

// ---------------------------------------------------------------- the folder menu

const ITEMS = 8;
function openFolderMenu(id, mode = null) {
  openOverlay({
    mod: "trailboss",
    props: { view: "folder-menu", id, mode },
    kind: "popup",
    width: 230,
    height: mode ? 110 : 34 + ITEMS * 27,
  });
}

function openFolderEdit(id) {
  openOverlay({ mod: "trailboss", props: { view: "folder-edit", id }, kind: "dialog", width: 420, height: 330 });
}

export class FolderMenu {
  init(p) {
    this.p = p;
    this.overlay = p.overlay;
    this.error = null;
    this.confirm = false;
    this.input = null;
    if (p.mode === "new") this.ask(null);
  }

  close() {
    closeOverlay(this.overlay);
  }

  ask(parent, cx) {
    const state = InputState.new({ placeholder: "folder name" });
    state.on("submit", (_e, cx) => cx.spawn((cx) => this.add(cx, parent, state.value().trim())));
    this.input = state;
    state.focus();
    cx?.notify();
  }

  async run(cx, args) {
    try {
      await folders(args);
      this.close();
    } catch (e) {
      this.error = err(e);
      cx.notify();
    }
  }

  async add(cx, parent, name) {
    if (!name) return this.close();
    await this.run(cx, ["add", name, ...(parent ? ["--parent", parent] : [])]);
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
    const state = shared(STATE);
    const f = state?.folders?.find((x) => x.id === this.p.id);
    const items = [];
    if (this.input) {
      items.push(
        div().px(6).py(4).child(Input.new(this.input).h(26).px(6).rounded(4).border_1().border_color(t.accent).bg(t.background).text_size(12)),
        div().px(10).text_size(10.5).text_color(t.dim).child("Enter to make it, Esc to cancel"),
      );
    } else if (f) {
      const focused = shared(FOCUS) === f.id;
      const current = focusedSpace();
      items.push(
        this.item(t, "new-space", "New space here", () => (newSpaceIn(f), this.close())),
        this.item(t, "new-sub", "New folder inside…", (_e, cx) => {
          if (!canMoveInto({ folders: [...state.folders, { id: "_", parent: f.id }] }, "_", f.id)) {
            this.error = "Folders go at most 4 levels deep.";
            return cx.notify();
          }
          this.ask(f.id, cx);
        }),
        this.item(t, "edit", "Edit…", () => (openFolderEdit(f.id), this.close())),
        this.item(t, "focus", focused ? "Show all spaces" : "Show only this folder", () => (setShared(FOCUS, focused ? null : f.id), this.close())),
        this.item(t, "fold", f.folded ? "Unfold" : "Fold", (_e, cx) => cx.spawn((cx) => this.run(cx, ["edit", f.id, f.folded ? "--unfold" : "--fold"]))),
      );
      if (current) items.push(this.item(t, "file-current", `Move ${short(current.name, 16)} here`, (_e, cx) => cx.spawn((cx) => this.run(cx, ["file", current.id, f.id]))));
      items.push(
        this.confirm
          ? this.item(t, "remove-yes", `Remove ${short(f.name, 16)}? Spaces stay`, (_e, cx) => cx.spawn((cx) => this.run(cx, ["remove", f.id])), true)
          : this.item(t, "remove", "Remove folder", (_e, cx) => {
              this.confirm = true;
              cx.notify();
            }, true),
      );
    }
    const title = f ? f.name : "New folder";
    return v_flex()
      .id("root")
      .size_full()
      .p(4)
      .gap(1)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(div().px(10).py(3).truncate().text_size(10.5).text_color(t.dim).child(title))
      .children(items)
      .when(Boolean(this.error), (el) => el.child(div().px(10).py(3).text_size(11).text_color(t.blocked).child(short(this.error, 120))));
  }
}

// The space in front, if any.
function focusedSpace() {
  const id = focused()?.space;
  return id ? spaces().find((s) => s.id === id) ?? null : null;
}

// A new space, started in the folder's start folder; the sidebar files it there when it appears.
function newSpaceIn(f) {
  setShared(PENDING, { folder: f.id, before: spaces().map((s) => s.id), at: Date.now() });
  run("space.new", f.start ? { folder: f.start } : {});
}

// ---------------------------------------------------------------- editing a folder

export class FolderEdit {
  init(p) {
    this.p = p;
    this.overlay = p.overlay;
    this.error = null;
    const f = shared(STATE)?.folders?.find((x) => x.id === p.id);
    this.color = f?.color ?? null;
    this.name = InputState.new({ placeholder: "Name", value: f?.name ?? "" });
    this.start = InputState.new({ placeholder: "~/code/acme (where new spaces start)", value: f?.start ?? "" });
    this.rules = InputState.new({ placeholder: "billing, ~/code/client-*, machine:vm-*", value: (f?.rules ?? []).join(", ") });
    for (const s of [this.name, this.start, this.rules]) s.on("submit", (_e, cx) => cx.spawn((cx) => this.save(cx)));
    this.name.focus();
  }

  async save(cx) {
    const rules = this.rules.value().split(",").map((r) => r.trim()).filter(Boolean);
    const args = ["edit", this.p.id, "--name", this.name.value(), "--start", this.start.value().trim(), "--color", this.color ?? "", "--no-rules"];
    for (const r of rules) args.push("--rule", r);
    try {
      await folders(args);
      closeOverlay(this.overlay);
    } catch (e) {
      this.error = err(e);
      cx.notify();
    }
  }

  field(t, label, state, hint) {
    return v_flex()
      .gap(3)
      .child(div().text_size(11.5).text_color(t.dim).child(label))
      .child(Input.new(state).h(28).px(8).rounded(5).border_1().border_color(t.border).bg(t.background).text_size(12.5))
      .when(Boolean(hint), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(hint)));
  }

  render() {
    const t = theme();
    return v_flex()
      .id("root")
      .size_full()
      .p(14)
      .gap(10)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(div().text_size(13).font_semibold().child("Edit folder"))
      .child(this.field(t, "Name", this.name))
      .child(
        v_flex()
          .gap(3)
          .child(div().text_size(11.5).text_color(t.dim).child("Color"))
          .child(
            h_flex()
              .gap(6)
              .children(
                [null, ...COLORS].map((c) =>
                  div()
                    .id(`color-${c ?? "none"}`)
                    .size(18)
                    .rounded(5)
                    .cursor_pointer()
                    .bg(c ? MARK[c] : t.surface)
                    .border_2()
                    .border_color(this.color === c ? t.foreground : t.border)
                    .on_click((_e, cx) => {
                      this.color = c;
                      cx.notify();
                    }),
                ),
              ),
          ),
      )
      .child(this.field(t, "Start folder", this.start))
      .child(this.field(t, "Rules", this.rules, "A folder name anywhere in the path, a path (* is one folder name), or machine:name. Spaces you file by hand stay put."))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(short(this.error, 160))))
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(div().id("cancel").px(10).py(4).rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => closeOverlay(this.overlay)).child("Cancel"))
          .child(
            div()
              .id("save")
              .px(10)
              .py(4)
              .rounded(5)
              .cursor_pointer()
              .bg(t.accent)
              .text_color(t.accent_foreground)
              .on_click((_e, cx) => cx.spawn((cx) => this.save(cx)))
              .child("Save"),
          ),
      );
  }
}
