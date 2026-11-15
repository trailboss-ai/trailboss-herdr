import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { tbRun, err } from "../lib.js";
import { reportArgs, readReport, reportTitle, reportWhere, reportDetail, isQueued } from "./report.js";

// The "Report back" card, shared by the thread pane's Tree view and Live's Sweep panel: the
// plan first (where it goes and the whole message), then Send runs it with --yes. A refusal
// shows in the CLI's words.

// A new card for a target; `step` fetches its plan.
export const newReport = (target) => ({ target, row: null, error: null, busy: false });

/** Runs the plan (or with `yes`, the real thing) into the card; `notify` redraws. */
export async function reportStep(card, yes, notify) {
  card.busy = true;
  card.error = null;
  notify();
  let r;
  try {
    r = readReport(await tbRun(reportArgs(card.target, yes)), card.target);
  } catch (e) {
    r = { error: err(e) };
  }
  card.busy = false;
  if (r.error) card.error = r.error;
  else card.row = r.row;
  notify();
  return r;
}

/** The card. `send` and `close` run on a click; `id` keeps its elements' ids apart. */
export function reportCard(t, card, { id = "report", send, close }) {
  const row = card.row;
  const done = isQueued(row);
  const canSend = Boolean(row) && !done && !card.busy && !card.error;
  const button = (key, label, solid, on, click) =>
    div()
      .id(`${id}-${key}`)
      .flex_none()
      .px(8)
      .py(2)
      .rounded(4)
      .text_size(11.5)
      .when(solid, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!solid, (el) => el.text_color(t.muted))
      .when(!on, (el) => el.opacity(0.5))
      .when(on, (el) =>
        el
          .cursor_pointer()
          .hover((s) => (solid ? s.opacity(0.85) : s.bg(t.hover).text_color(t.foreground)))
          .on_click((e, cx) => {
            cx.stop_propagation();
            click(e, cx);
          }),
      )
      .child(label);
  const status = card.busy ? (row ? "Sending…" : "Checking…") : "";
  return v_flex()
    .id(id)
    .flex_none()
    .m(8)
    .p(10)
    .gap(6)
    .rounded(6)
    .bg(t.surface)
    .border_1()
    .border_color(t.border)
    .child(div().text_size(11.5).font_semibold().child(reportTitle(card.target)))
    .when(Boolean(row), (el) =>
      el
        .child(div().text_size(11.5).text_color(t.muted).child(reportWhere(row)))
        .child(v_flex().id(`${id}-message`).max_h(180).p(6).rounded(4).bg(t.background).overflow_y_scrollbar().text_size(11.5).child(div().child(row.message ?? "")))
        .child(div().text_size(11).text_color(done ? t.done : t.dim).child(reportDetail(row))),
    )
    .when(Boolean(status), (el) => el.child(div().text_size(11).text_color(t.dim).child(status)))
    .when(Boolean(card.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(card.error)))
    .child(
      h_flex()
        .gap(6)
        .when(!done, (el) => el.child(button("send", "Send", true, canSend, send)))
        .child(button("close", done ? "Close" : "Cancel", false, true, close))
        .when(canSend, (el) => el.child(div().text_size(11).text_color(t.dim).child("Nothing is queued until Send."))),
    );
}
