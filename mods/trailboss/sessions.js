import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, run, spaces, terminals, home, notify, openOverlay, shared, setShared, knownAgents } from "herdr";
import { MOD, tb, err, age, short, shellWords, MISSING } from "./lib.js";

// Every agent's sessions in the side panel (what the session-history mod did): scoped to
// this folder, grouped by space, or all; filtered by agent and text; and resumed, copied,
// revealed or deleted from the row.

const SCOPES = [
  ["folder", "This folder"],
  ["spaces", "Spaces"],
  ["all", "All"],
];
// What trailboss reads sessions from (src/sources.rs).
export const AGENTS = [
  "claude", "codex", "opencode", "pi", "gemini", "cursor", "droid", "muse", "qoder", "codebuddy", "kimi", "kiro",
  "copilot", "grok", "omp", "devin", "openclaw", "antigravity", "prime", "zcode", "hermes", "cline", "rovo", "jcode",
];
const SCOPE_KEY = "trailboss.sessions.scope";
const AGENTS_KEY = "trailboss.sessions.agents";
const SHOWN = 40;
const RESCAN_MS = 15000;

const chosen = () => {
  const a = shared(AGENTS_KEY);
  return Array.isArray(a) && a.length ? a : AGENTS;
};
const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop() || p;
const under = (cwd, dir) => Boolean(cwd && dir) && (cwd === dir || cwd.startsWith(`${dir.replace(/\/+$/, "")}/`));

// Herdr's own icon for an agent, if it knows the program.
let programs = {};
async function loadPrograms() {
  try {
    for (const p of await knownAgents()) programs[p.key] = p;
  } catch {}
}
function icon(t, agent) {
  const p = programs[agent];
  if (p?.icon) return p.tint ? svg(p.icon).size(14).flex_none().text_color(t.foreground) : image(p.icon).w(16).h(16).flex_none();
  return div().w(16).h(16).flex_none().rounded(3).bg(t.raised).text_size(10).text_color(t.muted).flex().items_center().justify_center().child(agent[0].toUpperCase());
}

function badgeColor(t, agent) {
  return { pi: t.working, claude: t.done, codex: t.ansi4 ?? t.accent }[agent] ?? t.muted;
}

export class Sessions {
  init(_p, cx) {
    this.rows = null;
    this.error = null;
    this.loading = false;
    this.filter = "";
    this.open = null; // the expanded row
    this.confirm = null; // the row asking "Delete?"
    this.input = InputState.new({ placeholder: "Type to filter…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      cx.notify();
    });
    cx.spawn(async (cx) => {
      await loadPrograms();
      await this.load(cx);
    });
    cx.timer.every(RESCAN_MS, (cx) => cx.spawn((cx) => this.load(cx)));
  }

  async load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    try {
      const agents = chosen();
      const args = ["sessions", "-n", "120"];
      if (agents.length < AGENTS.length) args.push("--agent", agents.join(","));
      this.rows = await tb(args);
      this.error = null;
    } catch (e) {
      this.error = err(e);
    } finally {
      this.loading = false;
    }
    cx.notify();
  }

  matches(r) {
    const f = this.filter.trim().toLowerCase();
    if (!f) return true;
    return [r.agent, base(r.cwd), r.cwd, r.title, r.first_prompt, r.id].some((x) => (x ?? "").toLowerCase().includes(f));
  }

  // The space whose folder holds `cwd`, the deepest one if several do.
  spaceFor(cwd) {
    return spaces()
      .filter((s) => under(cwd, s.folder))
      .sort((a, b) => b.folder.length - a.folder.length)[0];
  }

  resume(r) {
    const active = spaces().find((s) => s.active);
    const folder = r.cwd || active?.folder || home();
    const name = short(r.title ?? base(folder), 30);
    const sp = this.spaceFor(folder);
    if (sp) {
      run("tab.new", { name, space: sp.id, folder, argv: r.resume_argv });
      run("space.select", { id: sp.id });
    } else {
      run("space.new", { name, folder, argv: r.resume_argv });
    }
  }

  async copy(r) {
    const text = (r.cwd ? `cd ${shellWords([r.cwd])} && ` : "") + shellWords(r.resume_argv);
    const res = await exec("sh", ["-c", 'printf %s "$1" | wl-copy 2>/dev/null || printf %s "$1" | xclip -selection clipboard', "sh", text]);
    notify(res.code === 0 ? { title: "Copied", body: text, level: "success", timeout: 2500 } : { title: "Couldn't copy", body: "Install wl-clipboard or xclip.", level: "warning" });
  }

  async remove(cx, r) {
    try {
      await tb(["delete", r.agent, r.id, "--yes"]);
      this.open = null;
      notify({ title: "Transcript deleted", body: r.path, level: "info", timeout: 3000 });
    } catch (e) {
      notify({ title: "Couldn't delete", body: err(e), level: "error" });
    }
    this.confirm = null;
    await this.load(cx);
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
      .on_click(onClick)
      .child(label);
  }

  row(t, r, i) {
    const key = `${r.agent}:${r.id}`;
    const open = this.open === key;
    const title = this.spaceFor(r.cwd)?.name ?? base(r.cwd) ?? r.cwd ?? r.id;
    const preview = r.first_prompt ?? r.title;
    return v_flex()
      .id(`s-${i}`)
      .px(8)
      .py(5)
      .gap(2)
      .rounded(6)
      .when(open, (el) => el.bg(t.raised))
      .child(
        h_flex()
          .id(`sh-${i}`)
          .gap(8)
          .items_center()
          .cursor_pointer()
          .on_click((_e, cx) => {
            this.open = open ? null : key;
            this.confirm = null;
            cx.notify();
          })
          .child(div().w(44).flex_none().truncate().text_size(10).font_semibold().text_color(badgeColor(t, r.agent)).child(r.agent.toUpperCase()))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(title))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(age(r.ended))),
      )
      .when(Boolean(preview), (el) => el.child(div().pl(52).truncate().text_size(11.5).text_color(t.muted).child(short(preview, 160))))
      .when(open, (el) =>
        el
          .child(div().pl(52).pt(2).truncate().text_size(11).text_color(t.dim).child(r.cwd ?? "(no folder recorded)"))
          .child(
            h_flex()
              .pl(52)
              .pt(4)
              .gap(6)
              .when(Boolean(r.resume_argv), (el) =>
                el
                  .child(this.button(t, `res-${i}`, "Resume", () => this.resume(r)))
                  .child(this.button(t, `cp-${i}`, "Copy cmd", (_e, cx) => cx.spawn(() => this.copy(r)))),
              )
              .when(Boolean(r.path), (el) =>
                el.child(this.button(t, `rv-${i}`, "Reveal", () => exec("xdg-open", [r.path.replace(/\/[^/]*$/, "") || "/"]))),
              )
              .when(Boolean(r.path) && this.confirm !== key, (el) =>
                el.child(this.button(t, `del-${i}`, "Delete", (_e, cx) => {
                  this.confirm = key;
                  cx.notify();
                })),
              )
              .when(this.confirm === key, (el) =>
                el
                  .child(this.button(t, `yes-${i}`, "Delete?", (_e, cx) => cx.spawn((cx) => this.remove(cx, r)), true))
                  .child(this.button(t, `keep-${i}`, "Keep it", (_e, cx) => {
                    this.confirm = null;
                    cx.notify();
                  })),
              ),
          ),
      );
  }

  list(t) {
    const scope = shared(SCOPE_KEY) ?? "folder";
    const rows = (this.rows ?? []).filter((r) => this.matches(r));
    const out = [];
    let shown = rows;
    if (scope === "folder") {
      const active = spaces().find((s) => s.active);
      const cwds = terminals()
        .filter((x) => x.state === "live" && x.labels?.["herdr.space"] === active?.id)
        .map((x) => x.cwd)
        .filter(Boolean);
      shown = rows.filter((r) => cwds.some((c) => under(r.cwd, c)));
    }
    if (scope === "spaces") {
      let n = 0;
      for (const sp of spaces()) {
        const mine = rows.filter((r) => this.spaceFor(r.cwd)?.id === sp.id);
        if (!mine.length) continue;
        out.push(div().px(8).pt(8).pb(2).text_size(11).text_color(t.dim).child(`${sp.name} (${mine.length})`));
        for (const r of mine) if (n++ < SHOWN) out.push(this.row(t, r, n));
      }
      shown = rows.filter((r) => this.spaceFor(r.cwd));
      if (shown.length > SHOWN) out.push(div().px(8).py(6).text_size(11).text_color(t.dim).child(`Showing ${SHOWN} of ${shown.length} — refine with filter`));
    } else {
      shown.slice(0, SHOWN).forEach((r, i) => out.push(this.row(t, r, i)));
      if (shown.length > SHOWN) out.push(div().px(8).py(6).text_size(11).text_color(t.dim).child(`Showing ${SHOWN} of ${shown.length} — refine with filter`));
    }
    if (this.rows && !shown.length) {
      out.push(
        div()
          .px(10)
          .py(6)
          .text_size(12)
          .text_color(t.dim)
          .child(
            scope === "folder"
              ? "No sessions for this space’s live folders. Switch to Spaces or All."
              : scope === "spaces"
                ? "No sessions match a space yet. Open a terminal in a project folder, or switch to All."
                : "No sessions found for the chosen agents.",
          ),
      );
    }
    return out;
  }

  render() {
    const t = theme();
    const scope = shared(SCOPE_KEY) ?? "folder";
    const agents = chosen();
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
          .child(div().flex_1().text_size(13).font_semibold().child("Sessions"))
          .child(
            div()
              .id("rescan")
              .cursor_pointer()
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => cx.spawn((cx) => this.load(cx)))
              .child(this.loading ? "…" : "↻"),
          )
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
          .px(12)
          .pb(8)
          .gap(4)
          .flex_none()
          .items_center()
          .children(
            SCOPES.map(([id, label]) =>
              div()
                .id(`scope-${id}`)
                .cursor_pointer()
                .px(8)
                .py(2)
                .rounded(10)
                .text_size(11.5)
                .bg(scope === id ? t.selected : t.surface)
                .text_color(scope === id ? t.foreground : t.muted)
                .hover((s) => s.bg(t.hover))
                .on_click(() => setShared(SCOPE_KEY, id))
                .child(label),
            ),
          )
          .child(div().flex_1())
          .child(
            div()
              .id("agents")
              .cursor_pointer()
              .px(6)
              .rounded(4)
              .text_size(11.5)
              .text_color(t.muted)
              .hover((s) => s.bg(t.hover))
              .on_click(() =>
                openOverlay({ mod: MOD, props: { view: "session-agents" }, kind: "popup", width: 200, height: Math.min(560, AGENTS.length * 26 + 40) }),
              )
              .child(`Agents (${agents.length}) ⌄`),
          ),
      )
      .child(
        div()
          .px(12)
          .pb(8)
          .flex_none()
          .child(
            Input.new(this.input)
              .h(28)
              .px(10)
              .rounded(7)
              .border_1()
              .border_color(t.input)
              .bg(t.background)
              .text_size(12)
              .text_color(t.foreground),
          ),
      )
      .when(Boolean(this.error), (el) =>
        el.child(div().px(12).pb(8).text_size(11).text_color(t.blocked).child(this.error === MISSING ? MISSING : short(this.error, 240))),
      )
      .when(this.loading && !this.rows, (el) => el.child(div().px(12).text_size(12).text_color(t.dim).child("Scanning sessions…")))
      .child(v_flex().id("list").flex_1().min_h(0).px(4).pb(6).gap(1).overflow_y_scrollbar().children(this.list(t)));
  }
}

export class SessionAgents {
  init(p, cx) {
    this.overlay = p.overlay;
    cx.spawn(async (cx) => {
      await loadPrograms();
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const on = chosen();
    return v_flex()
      .id("root")
      .size_full()
      .p(8)
      .gap(1)
      .bg(t.popover)
      .text_color(t.foreground)
      .overflow_y_scrollbar()
      .child(div().px(6).pb(4).text_size(11).text_color(t.dim).child("Agents to show"))
      .children(
        AGENTS.map((a) =>
          h_flex()
            .id(`a-${a}`)
            .gap(8)
            .px(6)
            .py(4)
            .rounded(4)
            .items_center()
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(() => {
              // Turning every agent off means all of them again.
              const next = on.includes(a) ? on.filter((x) => x !== a) : AGENTS.filter((x) => x === a || on.includes(x));
              setShared(AGENTS_KEY, next.length ? next : AGENTS);
            })
            .child(icon(t, a))
            .child(div().flex_1().text_size(12).child(programs[a]?.name ?? a))
            .when(on.includes(a), (el) => el.child(div().text_color(t.accent).child("✓"))),
        ),
      );
  }
}
