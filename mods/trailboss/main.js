import { View } from "gpui-kit";
import { props } from "herdr";
import { Block } from "./block.js";
import { Dashboard } from "./dashboard.js";
import { QuotaStrip, QuotaDetail, QuotaPicker } from "./quota.js";
import { Sessions, SessionAgents } from "./sessions.js";
import { Stats } from "./stats.js";
import { Insights } from "./insights.js";

// Trailboss in Herdr: a thin frontend over the `trailboss` CLI's --json output. One mod,
// several views, picked by the `view` prop a layout block or overlay passes:
//
//   (none)          the status-bar block: agents, today's cost, Claude's 5-hour pace;
//                   keeps sessions tracked and resumes them after a reboot
//   (none, overlay) the dashboard (mod.open:trailboss, Alt+Shift+T)
//   quota           the plan-quota strip for the status bar (replaces usage-bar)
//   sessions        the session list for the side panel (replaces session-history)
//   stats           delivery stats for the side panel (replaces stats)
//   insights        usage insights, as a window (replaces insights)
//   quota-detail, quota-picker, session-agents: their popups

const VIEWS = {
  quota: QuotaStrip,
  "quota-detail": QuotaDetail,
  "quota-picker": QuotaPicker,
  sessions: Sessions,
  "session-agents": SessionAgents,
  stats: Stats,
  insights: Insights,
};

export default class Trailboss extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const Kind = VIEWS[p.view] ?? (p.overlay ? Dashboard : Block);
    this.view = new Kind();
    this.view.init(p, cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
