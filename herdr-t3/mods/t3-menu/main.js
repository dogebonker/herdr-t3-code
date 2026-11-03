// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead, "space-icon" this mod again as the
// space's icon dialog (props { tab: "space-icon", target: { id } }).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, shared, setShared, home, appHome, pickFolder } from "herdr";
import * as fs from "fs/promises";
import { avatar, cacheImage } from "./space-icon.js";

// space.new without a folder starts where the focused terminal is; a new space here starts where the person picks.
// Cancelling the picker makes nothing.
const newSpace = (args = {}) => pickFolder({ prompt: "Open as space" }).then((folder) => { if (folder) run("space.new", { ...args, folder }); });

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      return [
        ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ["Close pane", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Icon…", "space-icon", { id: tg.id }],
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  if (command === "space-icon") return "mods/t3-menu/image.svg";
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    if (p?.tab === "space-icon") {
      this.error = null;
      this.glyphs = [];
      this.path = InputState.new({ placeholder: "~/path/to/icon.png" });
      this.path.on("submit", (_e, cx) => this.useFile(this.path.value(), cx));
      cx.spawn(async (cx) => {
        try { this.glyphs = (await fs.readdir(`${appHome()}/icons`)).filter((n) => n.endsWith(".svg")).sort(); } catch {}
        cx.notify();
      });
      return;
    }
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "space-icon") openOverlay({ mod: "t3-menu", kind: "dialog", width: 420, height: 520, props: { tab: "space-icon", target: it[2] } });
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else if (it[1] === "space.new") newSpace(it[2]);
    else run(it[1], it[2]);
  }

  setIcon(value) {
    setShared("space.icons", { ...(shared("space.icons") ?? {}), [props().target.id]: value });
  }

  // A picked or dropped file: copied as a small PNG where image() can draw it, then shown.
  useFile(raw, cx) {
    const h = home(), path = (raw ?? "").trim().replace(/^~(?=\/|$)/, h);
    if (!path.startsWith("/")) { this.error = "Type the image's full path (or ~/…)"; cx.notify(); return; }
    this.error = null;
    cx.spawn(async (cx) => {
      const rel = await cacheImage(path);
      if (rel) this.setIcon({ kind: "file", path: rel });
      else this.error = "Couldn't read an image there";
      cx.notify();
    });
  }

  // The space's icon dialog: every choice shows at once.
  icons(t) {
    const id = props().target?.id, s = spaces().find((x) => x.id === id);
    const frame = v_flex().id("space-icon").size_full().min_h(0).p(14).gap(10).bg(t.popover).text_size(13);
    if (!s) return frame.child(div().text_color(t.dim).child("That space is gone."));
    const pick = (shared("space.icons") ?? {})[id] ?? { kind: "auto" };
    const favicon = (shared("space.favicons") ?? {})[id];
    const check = svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground);
    const option = (key, label, sub, on, value) => h_flex().id(`icon-${key}`).h(42).px(10).gap(10).flex_none().rounded(8).items_center()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
      .role("button").accessibility_label(label).on_click(() => this.setIcon(value))
      .child(v_flex().flex_1().min_w(0).child(div().text_color(t.foreground).child(label)).child(div().truncate().text_size(11.5).text_color(t.dim).child(sub)))
      .when(on, (el) => el.child(check));
    const file = pick.kind === "file" && !pick.path?.startsWith("icons/");
    const heading = (text) => div().pt(4).px(2).text_size(11).font_medium().text_color(t.dim).child(text);
    return frame
      .child(h_flex().gap(12).items_center().flex_none()
        .child(avatar(id, s.name, 36, 9))
        .child(v_flex().min_w(0).child(div().truncate().font_semibold().text_color(t.foreground).child(s.name)).child(div().text_size(11.5).text_color(t.dim).child("Icon"))))
      .child(v_flex().gap(2).flex_none()
        .child(option("auto", "Automatic", favicon ? "The project's favicon" : s.machine ? "The letter: favicons are looked up on this computer only" : "The letter until the project has a favicon", pick.kind === "auto", { kind: "auto" }))
        .child(option("none", "Letter", "Its first letter on its color", pick.kind === "none", { kind: "none" })))
      .child(heading("Image"))
      .child(v_flex().id("icon-drop").flex_none().gap(8).p(10).rounded(8).border(1).border_dashed().border_color(file ? t.accent : t.input)
        .on_drop((e, cx) => this.useFile(e.paths?.[0], cx))
        .child(h_flex().gap(8).items_center().text_color(t.muted)
          .child(svg("mods/t3-menu/image.svg").size(14).flex_none())
          .child(div().flex_1().child(file ? "This space's own image. Drop another to change it." : "Drop an image here, or type its path:")))
        .child(h_flex().h(30).px(8).rounded(6).border(1).border_color(t.input).items_center()
          .child(Input.new(this.path).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
        .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error))))
      .child(heading("Herdr icons"))
      .child(div().id("icon-glyphs").flex_1().min_h(0).overflow_y_scroll()
        .child(h_flex().flex_wrap().gap(4).children(this.glyphs.map((n) => {
          const path = `icons/${n}`, on = pick.kind === "file" && pick.path === path;
          return h_flex().id(`glyph-${n}`).size(34).rounded(7).items_center().justify_center()
            .when(on, (el) => el.bg(t.selected).border(1).border_color(t.accent)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
            .role("button").accessibility_label(n.slice(0, -4)).tooltip(n.slice(0, -4))
            .on_click(() => this.setIcon({ kind: "file", path }))
            .child(svg(path).size(18).text_color(t.foreground));
        }))))
      .child(h_flex().flex_none().justify_end()
        .child(h_flex().id("icon-done").h(30).px(14).rounded(7).items_center().bg(t.solid).text_color(t.solid_foreground)
          .role("button").on_click(() => closeOverlay(props().overlay)).child("Done")));
  }

  render(cx) {
    const t = theme();
    if (props()?.tab === "space-icon") return this.icons(t);
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
