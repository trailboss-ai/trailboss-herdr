import { View } from "gpui-kit";
import { props, nextCommand } from "herdr";
import { Block } from "./fleet/block.js";
import { Dashboard } from "./fleet/dashboard.js";
import { QuotaStrip, QuotaDetail, QuotaPicker } from "./usage/quota.js";
import { Sessions, SessionAgents } from "./fleet/sessions.js";
import { Stats } from "./usage/stats.js";
import { Insights, openInsights } from "./usage/insights.js";
import { Files, FilesMenu } from "./files/files.js";
import { EditorView } from "./files/editor.js";
import { Changes } from "./files/changes.js";
import { Review } from "./files/review.js";

// Trailboss in Herdr: a thin frontend over the `trailboss` CLI's --json output. One mod,
// several views, picked by the `view` prop a layout block or overlay passes:
//
//   (none)          the status-bar block: agents, today's cost, Claude's 5-hour pace;
//                   keeps sessions tracked and resumes them after a reboot
//   (none, overlay) the dashboard (mod.open:trailboss, Alt+Shift+T)
//   quota           the plan-quota strip for the status bar (replaces usage-bar)
//   sessions        the session list for the side panel (replaces session-history)
//   stats           delivery stats for the side panel (replaces stats)
//   insights        usage insights, as a window (replaces insights; Alt+Shift+I opens it)
//   files           agent-aware files for the side panel (replaces Files)
//   editor          the multi-tab editor pane files open in
//   changes         agent-aware git changes for the side panel (replaces Changes)
//   review          review and undo one agent session's changes (a window, from Changes)
//   quota-detail, quota-picker, session-agents, files-menu: their popups

const VIEWS = {
  quota: QuotaStrip,
  "quota-detail": QuotaDetail,
  "quota-picker": QuotaPicker,
  sessions: Sessions,
  "session-agents": SessionAgents,
  stats: Stats,
  insights: Insights,
  files: Files,
  "files-menu": FilesMenu,
  editor: EditorView,
  changes: Changes,
  review: Review,
};

export default class Trailboss extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const Kind = VIEWS[p.view] ?? (p.overlay ? Dashboard : Block);
    this.view = new Kind();
    this.view.init(p, cx);
    // mod.open can't pass props, so Alt+Shift+I sends "trailboss.insights" instead. Every shown
    // copy gets it; only the status-bar block (always shown) acts, so it opens once.
    // ponytail: no block in the layout means no key; the dashboard button still works.
    if (Kind === Block) {
      cx.spawn(async () => {
        for (;;) if ((await nextCommand()) === "insights") openInsights();
      });
    }
  }

  render(cx) {
    return this.view.render(cx);
  }
}
