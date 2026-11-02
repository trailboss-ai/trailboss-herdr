import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme, openOverlay, notify, shared, setShared } from "herdr";
import { MOD, ICON, findBin, tb, plural, money, ymd, short, MISSING } from "../lib.js";
import { quotaRows } from "../usage/quota.js";
import { toWarn, warning } from "../usage/pace.js";

// The status-bar block: agents running, working / blocked, today's cost and the Claude
// 5-hour window. It keeps `trailboss` tracking which session runs in which terminal (every
// `live` call tracks), and when Herdr starts it runs `resume --auto`, which brings back
// what a reboot lost.

const POLL_MS = 15000;
const TODAY_EVERY = 4; // polls between cost refreshes (~1 min)
const QUOTA_EVERY = 20; // polls between quota checks (~5 min): those go to the network
const WARNED = "trailboss.quota.warned";

// Workspaces where two or more agents are working at once: they can overwrite each other.
export function crowded(live) {
  const by = {};
  for (const r of live ?? []) {
    if (r.workspace && (r.status === "working" || r.status === "busy")) (by[r.workspace] ??= []).push(r);
  }
  return Object.values(by).filter((rs) => rs.length > 1);
}

export class Block {
  init(_props, cx) {
    this.bin = null;
    this.error = null;
    this.live = [];
    this.today = null;
    this.quota = [];
    this.polls = 0;
    this.busy = false;
    cx.spawn(async (cx) => {
      this.bin = await findBin();
      if (!this.bin) {
        this.error = MISSING;
        cx.notify();
        return;
      }
      // Track first, so a resume knows the terminals as they are now.
      await this.poll(cx);
      await this.resume(cx, true);
    });
    cx.timer.every(POLL_MS, (cx) => cx.spawn((cx) => this.poll(cx)));
  }

  // Herdr already notifies about agents in its own terminals; Trailboss covers the rest
  // (VS Code, plain terminals). Set shared "trailboss.notify.herdr" to true for all of them.
  // Agents working in the same folder are Trailboss's own warning, wherever they run.
  announce(events) {
    const all = shared("trailboss.notify.herdr") === true;
    for (const e of events ?? []) {
      if (e.kind === "same_folder") {
        const first = (e.terminals ?? []).find(Boolean);
        notify({
          title: `${e.agents?.length ?? 2} agents are working in the same folder`,
          body: `${e.where}\n${e.cwd}`,
          level: "warning",
          icon: ICON,
          ...(first ? { action: { name: "pane.focus", args: { terminal: first } } } : {}),
        });
        continue;
      }
      if (e.kind === "ended" || (e.in_herdr && !all)) continue;
      const who = `${e.agent} ${e.where ?? ""}`.trim();
      const mins = Math.floor((e.worked_ms ?? 0) / 60000);
      notify({
        title: e.kind === "needs_you" ? `${who} needs you` : `${who} finished${mins ? ` after ${mins} min` : ""}`,
        body: e.title ?? e.cwd ?? "",
        level: e.kind === "needs_you" ? "warning" : "success",
        icon: ICON,
        ...(e.terminal && e.in_herdr ? { action: { name: "pane.focus", args: { terminal: e.terminal } } } : {}),
      });
    }
  }

  // Once per plan window that's on pace to run out before it resets.
  warnPace() {
    const { warn, warned } = toWarn(this.quota, shared(WARNED), Date.now() / 1000);
    if (!warn.length) return;
    setShared(WARNED, warned);
    for (const q of warn) notify({ ...warning(q), level: "warning", icon: ICON, timeout: 15000 });
  }

  async poll(cx) {
    if (!this.bin || this.busy) return;
    this.busy = true;
    try {
      // `events` is `live` plus what changed since the last look.
      const { live, events } = await tb(["events"]);
      this.live = live;
      this.announce(events);
      if (this.polls % TODAY_EVERY === 0) {
        const u = await tb(["usage", "--by", "all", "--since", ymd(new Date())]);
        this.today = u[0]?.cost_usd ?? 0;
      }
      // Shared with the quota strip: one refresh for both, at most every 5 minutes.
      if (this.polls % QUOTA_EVERY === 0) {
        this.quota = await quotaRows(5 * 60000).catch(() => this.quota);
        this.warnPace();
      }
      this.polls++;
      this.error = null;
    } catch (e) {
      this.error = String(e?.message ?? e);
    } finally {
      this.busy = false;
    }
    cx.notify();
  }

  // `auto` (at start): Trailboss itself only acts if the machine rebooted since it last saw
  // these terminals. By hand: everything lost.
  async resume(cx, auto) {
    if (!this.bin) return;
    while (this.busy) await exec("/bin/sleep", ["0.2"]);
    this.busy = true;
    let rows = [];
    try {
      rows = await tb(["resume", ...(auto ? ["--auto"] : [])]);
    } catch (e) {
      notify({ title: "Resume failed", body: String(e?.message ?? e), level: "error" });
    } finally {
      this.busy = false;
    }
    const done = rows.filter((r) => r.action === "resumed");
    const skipped = rows.filter((r) => r.action === "skipped");
    const yours = rows.filter((r) => r.action === "run it yourself");
    if (done.length || skipped.length) {
      notify({
        title: done.length
          ? `${auto ? "Auto-resumed" : "Resumed"} ${plural(done.length, "agent session")}` +
            (skipped.length ? `, ${skipped.length} not` : "")
          : `Couldn't resume ${plural(skipped.length, "agent session")}`,
        body: [...done.map((r) => r.where), ...skipped.map((r) => `${r.where}: ${r.detail}`)].join("\n"),
        level: skipped.length ? "warning" : "success",
      });
    } else if (!auto) {
      notify({
        title: yours.length ? `${plural(yours.length, "session")} outside Herdr to resume` : "No agent sessions to resume",
        body: yours.map((r) => r.detail).join("\n"),
        level: "info",
      });
    }
    await this.poll(cx);
  }

  openDashboard(tab = "Live") {
    openOverlay({ mod: MOD, props: { tab }, kind: "dialog", width: 860, height: 580 });
  }

  // ---------------------------------------------------------------- the dashboard

  render() {
    const t = theme();
    const live = this.live.filter((r) => r.agent);
    const working = live.filter((r) => r.status === "working" || r.status === "busy").length;
    const blocked = live.filter((r) => r.status === "blocked").length;
    const lost = this.live.filter((r) => (r.status ?? "").startsWith("lost")).length;
    const crowd = crowded(live);
    const five = this.quota.find((q) => q.provider === "claude" && q.window === "5h");
    const hot = (five?.pace_percent ?? 0) > 100;
    const sep = () => div().text_color(t.border).child("·");
    return h_flex()
      .id("root")
      .size_full()
      .px(12)
      .gap(8)
      .items_center()
      .justify_end()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .child(
        h_flex()
          .id("summary")
          .gap(8)
          .items_center()
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click(() => this.openDashboard())
          .child(image(ICON).w(14).h(14))
          .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(short(`Trailboss: ${this.error}`, 70))))
          .when(!this.error, (el) =>
            el
              .child(plural(live.length, "agent"))
              .when(working > 0, (el) => el.child(div().text_color(t.working).child(`${working} working`)))
              .when(blocked > 0, (el) => el.child(div().text_color(t.blocked).child(`${blocked} waiting`)))
              .when(crowd.length > 0, (el) =>
                el.child(div().text_color(t.blocked).child(`⚠ ${crowd.reduce((n, g) => n + g.length, 0)} in one folder`)),
              )
              .when(this.today != null, (el) => el.child(sep()).child(`${money(this.today)} today`))
              .when(Boolean(five), (el) =>
                el.child(sep()).child(
                  div()
                    .text_color(hot ? t.blocked : t.muted)
                    .child(`5h ${five.used}${five.pace ? ` → ${five.pace.replace(" ⚠", "")}` : ""}`),
                ),
              ),
          ),
      )
      .when(lost > 0, (el) =>
        el.child(
          div()
            .id("resume")
            .cursor_pointer()
            .px(8)
            .rounded(4)
            .bg(t.accent)
            .text_color(t.accent_foreground)
            .hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => cx.spawn((cx) => this.resume(cx, false)))
            .child(`Resume ${lost}`),
        ),
      );
  }
}
