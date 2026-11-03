// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "t3-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, terminals, props, run, theme, home, layout, shared, setShared } from "herdr";
import { namer } from "./name.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// Settled in the Focus list isn't news, so its done dot goes, as in the tabs.
function settled(p) {
  const find = (n) => n?.id === "sidebar-lists" ? n : (n?.children ?? []).map(find).find(Boolean);
  return find(layout())?.active === "focus" && (k => Boolean(k?.labels?.settled) || +(k?.labels?.snoozed ?? "").split(":")[0] > Date.now())(terminals().find((k) => k.address === p.terminal));
}

export default class Pane extends View {
  init() { this.hovered = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, label, action) {
    return div()
      .id(id)
      .size(26).flex_none().flex().items_center().justify_center()
      .rounded(6)
      .text_color(t.muted)
      .role("button").accessibility_label(label)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
      })
      .child(svg(icon).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = namer()(p);
    const pic = icon(p.program, 14, t.muted);
    const st = p.status;
    const pane = p.pane;
    // A reference the Focus list armed (a card dragged out toward the panes): another agent's header takes it,
    // released or clicked on; t3-focus types it in.
    // One older than its 10s (Focus reloaded or not running) is stale.
    const ref = shared("focus.ref"), target = Boolean(ref && !ref.to && Date.now() - (ref.at ?? 0) < 10000 && p.status != null && p.terminal !== ref.address);
    const take = (_e, cx) => {
      cx.stop_propagation();
      // The current one, not this render's: a press already took it, and its release mustn't re-arm it.
      const cur = shared("focus.ref");
      if (!cur || cur.to) return;
      setShared("focus.ref", { ...cur, to: pane });
      run("t3-focus.reference");
    };
    // The rounded frame paints the background; rectangular child fills would cover its corners.
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(8)
      .gap(8)
      .items_center()
      .text_size(13)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).text_size(13).font_medium().text_color(p.focused ? t.foreground : t.muted).child(name))
      .when(target, el => el.on_mouse_down("left", take).on_mouse_up("left", take)
        .child(h_flex().id(`ph-ref-${pane}`).flex_1().min_w(0).h(22).px(8).gap(6).items_center().rounded(6)
          .border(1).border_color(t.accent + "66").bg(t.accent + "1a").text_size(12).text_color(t.accent)
          .role("button").accessibility_label(`Drop to reference ${ref.title}`)
          .child(div().truncate().child(`Drop to reference ${ref.title}`))))
      .when(!target, el => el.child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd))))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      // The same marks as the agents list and tabs.
      .when(st === "blocked", el => el.child(div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(11).font_bold().text_color(t.blocked).flex().items_center().justify_center().accessibility_label("Needs you").child("!")))
      // Marked unread in the Focus list (its `unread` label) reads as done until looked at.
      .when((st === "done" || Boolean(terminals().find((k) => k.address === p.terminal)?.labels?.unread)) && !settled(p), el => el.child(div().size(7).flex_none().rounded_full().bg(t.done)))
      .when(this.hovered, el => el.child(h_flex().flex_none().gap(4).items_center()
        .child(this.button(t, `ph-r-${pane}`, "mods/t3-pane/split-right.svg", "Split right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(t, `ph-d-${pane}`, "mods/t3-pane/split-down.svg", "Split down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, `mods/t3-pane/${p.zoomed ? "unzoom" : "zoom"}.svg`, p.zoomed ? "Unzoom pane" : "Zoom pane", () => run("pane.zoom", { pane })))
        .child(this.button(t, `ph-x-${pane}`, "mods/t3-pane/close.svg", "Close pane", () => run("pane.close", { pane })))));
  }
}
