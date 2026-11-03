// Create or edit a theme, after T3 Code's theme editor. Opened as a dialog
// (`mod.open:t3-theme`). Starts from the shown theme; pick another base on the right.
// Save writes themes/<slug>.json and switches to it. Cancel/Esc changes nothing:
// edits show only in the preview until saved, so the previous theme stays.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, themes, settings, appHome, readTextFile, writeTextFile, run, props, closeOverlay } from "herdr";
import { GROUPS, KEYS, validHex, normHex, slugify, invalidKeys, themeJson, fromThemeJson } from "./theme-file.js";

const swatch = (c) => (validHex(c) ? normHex(c) : "#00000000");

export default class ThemeEditor extends View {
  init(_props, cx) {
    this.vals = {};
    this.inputs = {};
    for (const k of KEYS) {
      const s = InputState.new({ placeholder: "#rrggbb" });
      s.on("change", (_e, cx) => { this.vals[k] = s.value(); this.error = null; cx.notify(); });
      this.inputs[k] = s;
    }
    this.name = InputState.new({ placeholder: "e.g. Aurora" });
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.paste = TextareaState.new({ placeholder: "Paste a theme JSON file", rows: 5 });
    this.importing = false;
    this.error = null;
    this.load(settings().theme ?? themes()[0]?.name, cx);
    this.name.focus();
  }

  // Start from a theme: its resolved colors, and its file if it has one.
  load(name, cx) {
    const base = themes().find((t) => t.name === name);
    if (!base) return;
    this.base = name;
    this.file = null;
    for (const k of KEYS) this.set(k, base.colors[k] ?? "");
    this.name.set_value(name);
    this.error = null;
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${appHome()}/themes/${name}.json`);
      if (this.base !== name) return;
      this.file = text === null ? null : { slug: name, text };
      if (!this.file) this.name.set_value(`${name}-custom`);
      cx.notify();
    });
  }

  set(k, v) {
    this.vals[k] = v;
    this.inputs[k].set_value(v);
  }

  importJson(cx) {
    try {
      const vals = fromThemeJson(JSON.parse(this.paste.value()));
      for (const [k, v] of Object.entries(vals)) this.set(k, v);
      this.importing = false;
      this.error = null;
    } catch (e) {
      this.error = `Import failed: ${e.message}`;
    }
    cx.notify();
  }

  async save(cx) {
    const slug = slugify(this.name.value());
    const bad = invalidKeys(this.vals);
    if (!slug) this.error = "Name the theme first.";
    else if (bad.length) this.error = `${bad.length} invalid color${bad.length === 1 ? "" : "s"}: use #rgb, #rrggbb or #rrggbbaa.`;
    if (this.error) return cx.notify();
    const editing = this.file?.slug === slug;
    const path = `${appHome()}/themes/${slug}.json`;
    try {
      if (!editing) {
        // Never replace a file this editor didn't open (a null snapshot also makes writeTextFile refuse one).
        if ((await readTextFile(path)) !== null) throw new Error(`"${slug}" already exists. Pick it under Start from to edit it.`);
        if (themes().some((t) => t.name === slug)) throw new Error(`"${slug}" is a built-in theme. Pick another name.`);
      }
      await writeTextFile(path, `${JSON.stringify(themeJson(this.vals), null, 2)}\n`, editing ? this.file.text : null);
      run("app.theme", { name: slug });
      closeOverlay(props().overlay);
    } catch (e) {
      this.error = e.message ?? String(e);
      cx.notify();
    }
  }

  // A small sidebar / tabs / pane picture in the edited colors.
  preview() {
    const c = (k) => swatch(this.vals[k]);
    const bar = (w, k) => div().w(w).h(5).rounded(3).bg(c(k));
    const dot = (k) => div().size(7).rounded_full().bg(c(k));
    const agent = (status, sel) => h_flex().h(20).px(6).gap(6).items_center().rounded(5)
      .when(sel, (el) => el.bg(c("selected"))).child(dot(status)).child(bar(sel ? 50 : 40, sel ? "foreground" : "muted"));
    const tab = (on) => h_flex().h(20).px(8).items_center().rounded(5)
      .when(on, (el) => el.bg(c("surface")).border_1().border_color(c("border")))
      .child(bar(on ? 34 : 26, on ? "foreground" : "dim"));
    const line = (parts) => h_flex().gap(4).children(parts.map(([w, k]) => bar(w, k)));
    return h_flex().id("preview").h(200).rounded(8).overflow_hidden().border_1().border_color(c("border")).bg(c("canvas"))
      .child(v_flex().w(96).h_full().p(6).gap(3).bg(c("chrome")).border_r_1().border_color(c("border"))
        .child(div().h(12).child(bar(40, "dim")))
        .child(agent("working", true)).child(agent("blocked", false)).child(agent("done", false)).child(agent("idle", false))
        .child(div().flex_1())
        .child(h_flex().h(18).justify_center().items_center().rounded(5).bg(c("solid")).child(bar(30, "solid_foreground"))))
      .child(v_flex().flex_1().h_full().min_w(0)
        .child(h_flex().h(30).px(6).gap(4).items_center().child(tab(true)).child(tab(false)).child(div().flex_1()).child(dot("accent")))
        .child(v_flex().flex_1().mx(6).mb(6).rounded(6).overflow_hidden().bg(c("background"))
          .child(h_flex().h(16).px(6).gap(4).items_center().border_b_1().border_color(c("border")).child(dot("working")).child(bar(40, "muted")))
          .child(v_flex().p(7).gap(6)
            .child(line([[10, "ansi2"], [40, "terminal_foreground"]]))
            .child(line([[24, "ansi4"], [18, "ansi5"], [22, "ansi3"]]))
            .child(h_flex().gap(4).child(h_flex().px(2).h(9).items_center().bg(c("selection")).child(bar(30, "terminal_foreground"))).child(bar(20, "ansi1")))
            .child(line([[16, "ansi6"], [28, "ansi8"]]))
            .child(h_flex().gap(4).items_center().child(bar(10, "ansi2")).child(div().w(5).h(9).bg(c("cursor")))))));
  }

  row(t, k, label) {
    const ok = validHex(this.vals[k]);
    return h_flex().id(`row-${k}`).h(28).gap(8).items_center().min_w(0)
      .child(div().size(16).flex_none().rounded(4).border_1().border_color(t.input).bg(swatch(this.vals[k])))
      .child(div().flex_1().min_w(0).truncate().text_color(ok ? t.muted : t.blocked).child(ok ? label : `${label} · invalid`))
      .child(h_flex().id(`hex-${k}`).w(96).h(24).flex_none().px(6).items_center().rounded(5).border_1()
        .border_color(ok ? t.input : t.blocked).bg(t.background)
        .child(Input.new(this.inputs[k]).flex_1().h_full().text_size(12).text_color(ok ? t.foreground : t.blocked)));
  }

  group(t, g) {
    const half = Math.ceil(g.fields.length / 2);
    const col = (fs) => v_flex().flex_1().min_w(0).gap(2).children(fs.map(([k, l]) => this.row(t, k, l)));
    return v_flex().gap(6)
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(g.title))
      .child(h_flex().gap(16).items_start().child(col(g.fields.slice(0, half))).child(col(g.fields.slice(half))));
  }

  render(cx) {
    const t = theme();
    const slug = slugify(this.name.value());
    const editing = !!slug && this.file?.slug === slug;
    const bad = invalidKeys(this.vals).length;
    const button = (id, label, bg, fg, onClick, border = bg) =>
      h_flex().id(id).h(30).px(12).items_center().rounded(7).border_1().border_color(border).bg(bg).text_color(fg)
        .cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    const chip = (th) => {
      const on = th.name === this.base;
      return h_flex().id(`base-${th.name}`).h(26).px(8).gap(6).items_center().rounded(6).border_1()
        .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.load(th.name, cx); cx.notify(); })
        .child(h_flex().gap(2).children(["background", "accent", "foreground"].map((k) =>
          div().size(8).rounded_full().border_1().border_color(t.border).bg(th.colors[k] ?? "#000000"))))
        .child(div().text_color(on ? t.foreground : t.muted).child(th.name));
    };
    return v_flex().id("t3-theme").size_full().min_h(0).bg(t.popover).text_size(12)
      .child(h_flex().h(44).flex_none().px(16).gap(10).items_center().border_b_1().border_color(t.border)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(editing ? "Edit theme" : "Create theme"))
        .child(div().flex_1().truncate().text_color(t.dim)
          .child(slug ? (editing ? `Editing themes/${slug}.json` : `New file themes/${slug}.json`) : "Name the theme"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().flex_1().min_h(0)
        .child(v_flex().id("colors").flex_1().min_w(0).h_full().overflow_y_scrollbar().p(16).gap(16)
          .children(GROUPS.map((g) => this.group(t, g))))
        .child(v_flex().w(320).flex_none().h_full().p(16).gap(14).border_l_1().border_color(t.border)
          .child(v_flex().gap(6)
            .child(div().font_semibold().text_color(t.foreground).child("Name"))
            .child(h_flex().h(30).px(8).items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
              .child(Input.new(this.name).flex_1().h_full().text_size(12.5).text_color(t.foreground))))
          .child(v_flex().gap(6)
            .child(div().font_semibold().text_color(t.foreground).child("Start from"))
            .child(h_flex().flex_wrap().gap(6).children(themes().map(chip))))
          .child(v_flex().gap(6)
            .child(div().font_semibold().text_color(t.foreground).child("Preview"))
            .child(this.preview()))
          .child(this.importing
            ? v_flex().gap(6)
              .child(div().rounded(7).border_1().border_color(t.input).bg(t.background).p(6)
                .child(Textarea.new(this.paste).h(84).text_size(11.5).text_color(t.foreground)))
              .child(h_flex().gap(6).justify_end()
                .child(button("import-cancel", "Close", t.raised, t.foreground, (_e, cx) => { this.importing = false; cx.notify(); }, t.input))
                .child(button("import-apply", "Apply JSON", t.raised, t.foreground, (_e, cx) => this.importJson(cx), t.input)))
            : h_flex().id("import").gap(6).items_center().text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { this.importing = true; this.paste.focus(); cx.notify(); })
              .child("Import from JSON…"))))
      .child(h_flex().h(52).flex_none().px(16).gap(8).items_center().border_t_1().border_color(t.border)
        .child(div().flex_1().truncate().text_color(this.error || bad ? t.blocked : t.dim)
          .child(this.error ?? (bad ? `${bad} invalid color${bad === 1 ? "" : "s"}` : "Edits show in the preview until you save.")))
        .child(button("cancel", "Cancel", t.raised, t.foreground, () => closeOverlay(props().overlay), t.input))
        .child(button("save", editing ? "Save changes" : "Create theme", t.solid, t.solid_foreground, (_e, cx) => cx.spawn((cx) => this.save(cx)))));
  }
}
