// The focus sidebar: no spaces, only the agents still asking for attention, as cards, latest news first.
// Below, as in T3: Working (busy agents, folded) and Settled (put away by hand until new work brings them back).
// Settled lives on the agent's own terminal as `settled=<ms>:<turn>`: it ends with the terminal, every mod
// sees it, and a turn ended since says there was new work even while no window watched. Looking doesn't count.
// Snoozed, as T3's: `snoozed=<wake ms>:<ms>` hides an agent on its own shelf until its time, or until it (or one
// under it) needs the person. Waking puts it on top of Active, marked Woke until looked at, with a notification.
// Mark unread, as T3's: `unread=<ms>` shows a finished agent as Done (not yet seen) until it's next looked at.
// The app's own seen state has no way back, so the mark is the mod's, and pane headers read it too.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Popover, Popup, InputState, Input, CalendarState } from "gpui-base";
import { agents, terminals, panes, spaces, focused, run, hc, notify, theme, shared, setShared, setAgentOrder, props, nextCommand, settings, layout, exec, home, pickFolder } from "herdr";
import { namer } from "./name.js";
// Space avatars (icon, favicon or letter), t3-spaces' rule: drawn here with 4px corners.
import { avatar } from "./space-icon.js";

// space.new without a folder starts where the focused terminal is; a new space here starts where the person picks.
// Cancelling the picker makes nothing.
const newSpace = (args = {}) => pickFolder({ prompt: "Open as space" }).then((folder) => { if (folder) run("space.new", { ...args, folder }); });

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const BUSY = new Set(["working", "blocked"]);
// The settled tail opens on this many, then grows by MORE.
const FIRST = 10, MORE = 25;
// A run that stops stays on the Working shelf this long (ms), as in T3: a quick continuation doesn't move it twice.
const GRACE = 2000;
// Snooze's motion: a card folding out of Active, rows growing into and out of the Snoozed shelf, its menu fading in.
const EASE = { duration: 180, easing: "ease-out" };
const FADE = { duration: 120, easing: "ease-out" };
// The last word when times tie, so the order doesn't follow the order the data came in.
const byAddress = (x, y) => x.address.localeCompare(y.address);

// A sub-agent's own word: error counts as blocked; its done is its parent's news, not its own.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// As T3's sidebar times: no "ago", nothing past days.
function ago(ms, now) {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

// How long it's been working, as T3's Working pill: 9s, 4m, 1h 5m.
function took(ms, now) {
  const s = Math.max(0, Math.floor((now - ms) / 1000)), m = Math.floor(s / 60);
  return s < 60 ? `${s}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// T3's default snooze menu: in 1 hour, in 3 hours, this evening at 18:00, tomorrow at 9:00, next Monday at 9:00.
function presets(now) {
  const d = new Date(now);
  const at = (days, h) => { const x = new Date(now); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.getTime(); };
  return [["In 1 hour", now + 3600000], ["In 3 hours", now + 3 * 3600000],
    ...(d.getHours() < 18 ? [["This evening", at(0, 18)]] : []),
    ["Tomorrow", at(1, 9)], ["Next week", at((8 - d.getDay()) % 7 || 7, 9)]];
}

// A wake time as the shelf says it: 18:00, Tomorrow 9:00, Mon 9:00, and a week or more out, Nov 12 9:00.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function wakes(ms, now) {
  const d = new Date(ms), time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? time : days === 1 ? `Tomorrow ${time}` : days < 7 ? `${DAYS[d.getDay()]} ${time}` : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}

// Typed days and months: any start of the name, three letters or more ("fri", "thurs", "november").
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const named = (names, word) => (word?.length >= 3 ? names.findIndex((n) => n.startsWith(word)) : -1);

// Whether this machine writes 31/12 or 12/31, so "12/11" means what the person means; null when it can't tell.
const DAY_FIRST = (() => {
  const s = new Date(2000, 11, 31).toLocaleDateString(), d = s.indexOf("31"), m = s.indexOf("12");
  return s.startsWith("2000") || d < 0 || m < 0 ? null : d < m;
})();

// A typed snooze, the next such time: "30m", "2h", "in 3 days", "14:30", "9", "tomorrow 8:00", "fri",
// "friday 10:00", "mon 9", "nov 12", "12/11 14:00" (in this machine's day/month order), "2026-11-12 9:00".
// A day without a time is 9:00, as the presets. null: not one, or past.
function parseWake(text, now) {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  const span = /^(?:in )?(\d+) ?(m|mins?|minutes?|h|hrs?|hours?|d|days?)$/.exec(s);
  if (span) return +span[1] > 0 ? now + +span[1] * { m: 60000, h: 3600000, d: 86400000 }[span[2][0]] : null;
  const T = "(?: (\\d{1,2})(?::(\\d{2}))?)?$", hm = (h = 9, min = 0) => (+h > 23 || +min > 59 ? null : [+h, +min]);
  let m = /^(tomorrow )?(\d{1,2})(?::(\d{2}))?$/.exec(s), t;
  if (m) {
    if (!(t = hm(m[2], m[3]))) return null;
    const x = new Date(now);
    x.setHours(t[0], t[1], 0, 0);
    if (m[1] || x.getTime() <= now) x.setDate(x.getDate() + 1);
    return x.getTime();
  }
  m = new RegExp(`^([a-z]+)${T}`).exec(s);
  const wd = named(WEEKDAYS, m?.[1]);
  if (wd >= 0) {
    if (!(t = hm(m[2], m[3]))) return null;
    const x = new Date(now);
    x.setHours(t[0], t[1], 0, 0);
    x.setDate(x.getDate() + (wd - x.getDay() + 7) % 7);
    if (x.getTime() <= now) x.setDate(x.getDate() + 7);
    return x.getTime();
  }
  // [year (null: the next one it's still ahead in), month 0-11, day, hour, minute]
  const date = (m = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${T}`).exec(s)) ? [+m[1], m[2] - 1, +m[3], m[4], m[5]]
    : (m = new RegExp(`^([a-z]+) (\\d{1,2})${T}`).exec(s)) && named(MONTH_NAMES, m[1]) >= 0 ? [null, named(MONTH_NAMES, m[1]), +m[2], m[3], m[4]]
    : DAY_FIRST !== null && (m = new RegExp(`^(\\d{1,2})/(\\d{1,2})${T}`).exec(s)) ? [null, (DAY_FIRST ? m[2] : m[1]) - 1, +(DAY_FIRST ? m[1] : m[2]), m[3], m[4]]
    : null;
  if (!date || !(t = hm(date[3], date[4]))) return null;
  const [y, mo, d] = date, year = y ?? new Date(now).getFullYear(), on = (yy) => new Date(yy, mo, d, t[0], t[1]);
  const x = y == null && on(year).getTime() <= now ? on(year + 1) : on(year);
  // 31/2 rolls into March: not a date.
  return x.getMonth() === mo && x.getDate() === d && x.getTime() > now ? x.getTime() : null;
}

// A card's PR, as T3's badge says it, from `gh pr view <branch> --json number,state,isDraft,statusCheckRollup,url`:
// open, draft, merged or closed, and its checks failing, pending, passing, or null with none.
const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
function prOf(text) {
  const p = JSON.parse(text), runs = p.statusCheckRollup ?? [], word = (c) => (c.conclusion || c.state || "").toUpperCase();
  // A check run says it's done in `status`; a status context only through its state.
  const done = (c) => (c.status ? c.status.toUpperCase() === "COMPLETED" : !["PENDING", "EXPECTED"].includes(word(c)));
  const ci = !runs.length ? null : runs.some((c) => FAILED.has(word(c))) ? "failing" : runs.some((c) => !done(c)) ? "pending" : "passing";
  return { number: p.number, url: p.url, state: p.state === "OPEN" && p.isDraft ? "draft" : String(p.state).toLowerCase(), ci };
}
// gh is asked about a branch again after this long (ms), and about at most this many at once.
const PR_AGE = 180000, PR_RUNS = 2;

// A reference is pasted into a live prompt, and titles and folders come from the programs themselves: a newline
// would submit it and an escape could end the paste, so control and format characters become spaces.
function oneLine(text) {
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").replace(/ {2,}/g, " ");
}

// The program's icon from the app's table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Focus extends View {
  init(_props, cx) {
    // A reference armed before a reload or quit lost its timer: disarm it, or the next header click pastes it.
    if (shared("focus.ref")) setShared("focus.ref", null);
    // Each agent's last state, when we saw it set going or come back (ms; 0: before we were watching), the turns
    // it had ended then, and for one that just stopped, when its run started.
    this.changed = JSON.parse(localStorage.getItem("changes") ?? "{}");
    this.open = localStorage.getItem("open") === "true";
    this.workOpen = localStorage.getItem("working-open") === "true";
    this.limit = FIRST;
    // Settled labels written but not back from the core yet: address → value ("" = removed).
    this.pending = {};
    // The same for snoozed labels; who woke and isn't looked at yet (address → ms); which card's snooze menu is open.
    this.snoozing = {};
    this.woke = JSON.parse(localStorage.getItem("woke") ?? "{}");
    this.dozeOpen = localStorage.getItem("snoozed-open") === "true";
    this.snoozeFor = null;
    // The same for unread labels; the right-click menu ({ for: address, at: where in the sidebar }).
    this.marking = {};
    this.menu = null;
    // Cards picked with cmd/shift-click, as T3's thread selection: the set, the range's anchor, and the focus to
    // give back (the sidebar takes the keyboard while it holds a selection, so Esc can clear it).
    this.selected = new Set();
    this.anchor = this.selBack = null;
    // Motion only animates a change, so what appears or leaves draws one frame at its start first (see step).
    // key → false (that first frame) or true (moving). `in-…` keys end when not drawn, `out-…` keys on a timer.
    this.motion = {};
    this.used = new Set();
    // Each card's height (to fold it away), cards folding out of Active, rows folding out of Snoozed.
    this.heights = {};
    this.leaving = {};
    this.gone = {};
    this.snoozeInput = InputState.new({ placeholder: "30m, 14:30, fri 10:00, nov 12" });
    this.snoozeInput.on("submit", (_e, cx) => {
      const ms = parseWake(this.snoozeInput.value(), Date.now());
      if (ms) this.snoozeTo?.(this.snoozeFor, ms, cx);
      cx.notify();
    });
    // The menu's "Pick date & time…": a month to pick a day in and a time on it (see picker in render).
    this.picking = false;
    this.calendar = CalendarState.new();
    this.wakeTime = InputState.new({ placeholder: "9:00" });
    this.wakeTime.on("change", (_e, cx) => cx.notify());
    // Each card branch's PR (key → { at, pr, running }), and how many gh runs are out.
    this.prs = {};
    this.prRuns = 0;
    this.hovered = null;
    // The spaces shown, as T3 scopes threads to projects; none: all of them.
    this.scope = JSON.parse(localStorage.getItem("scope") ?? "[]");
    this.scopeOpen = false;
    this.search = InputState.new({ placeholder: "Search spaces…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.search.on("submit", (_e, cx) => this.pick(this.matches()[0], false, cx));
    // Takes the keyboard while a row is lifted, so Esc can put it back.
    this.keys = cx.focus_handle();
    // "Working 9s" counts up only while such a card shows.
    cx.timer.every(1000, (cx) => { if (this.ticking) cx.notify(); });
    // The cards' times (5m, 2h) move on by the minute, as T3's do.
    cx.timer.every(60000, (cx) => cx.notify());
    // Snoozes wake here too, not only in render: render doesn't run while the window is in the background.
    cx.timer.every(15000, (cx) => { if (this.wake(cx)) cx.notify(); });
    // `t3-focus.settle` (cmd-shift-s in keys.json): see settleKey in render. `t3-focus.jump-1`..`-9`
    // (cmd-1..9 in the T3 layout): the Nth card, as T3's thread.jump.N.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "settle") this.settleKey?.(cx);
        else if (/^jump-[1-9]$/.test(c)) this.jump?.(+c.slice(5));
        // `t3-focus.reference`, from a pane header (t3-pane) the armed reference was dropped on: shared "focus.ref".to.
        else if (c === "reference" && shared("focus.ref")?.to) {
          const r = shared("focus.ref");
          this.unref(false);
          // A pane closed before the drop arrived: pasting now would land in whatever has focus instead.
          if (panes().some((p) => p.pane === r.to)) this.insertRef(r.text, { pane: r.to }, cx);
        }
        cx.notify();
      }
    });
  }

  matches() {
    const q = this.search.value().toLowerCase();
    return [{ id: null, name: "All spaces" }, ...spaces()].filter((s) => s.name.toLowerCase().includes(q));
  }

  // A click shows that space alone; shift-click adds or removes it and keeps the menu open, as in T3.
  pick(s, shift, cx) {
    if (!s) return;
    this.scope = !s.id ? [] : !shift ? [s.id] : this.scope.includes(s.id) ? this.scope.filter((id) => id !== s.id) : [...this.scope, s.id];
    localStorage.setItem("scope", JSON.stringify(this.scope));
    // A new scope starts the settled tail over, as T3's does.
    this.limit = FIRST;
    if (!shift) this.scopeOpen = false;
    cx.notify();
  }

  // Takes each agent's state as working, blocked or idle (done counts as idle: looking at it isn't news).
  // A run's place in Working is when it started, as T3's is the person's message: a pause for them, or a stop
  // that goes on within the grace, is the same run. Pinned and settled ones skip the grace, as in T3: their
  // place doesn't hang on it. A turn ended while we weren't watching is news too.
  track(list, all, now, cx) {
    let dirty = false;
    for (const { address, s, turn, excluded } of list) {
      let was = this.changed[address];
      // The grace ran out: back with the person as of then, so it lands on top, and the run is over.
      if (was?.s === "idle" && was.start != null && (excluded || now - was.at >= GRACE)) {
        was = this.changed[address] = { s: "idle", at: excluded ? now : was.at + GRACE, turn: was.turn };
        dirty = true;
      }
      if (was?.s === s && (s !== "idle" || turn <= (was.turn ?? turn))) continue;
      const grace = was?.s === "working" && s === "idle" && !excluded;
      if (grace) cx.timer.after(GRACE, (cx) => cx.notify());
      this.changed[address] = !was ? { s, at: 0, turn } // First sight says nothing about when it changed.
        : s === "working" ? { s, at: was.start ?? now, turn }
        : s === "blocked" ? { s, at: now, turn, start: was.s === "working" ? was.at : was.start }
        : grace ? { s, at: now, turn, start: was.at } // Stopped: the grace begins.
        : was.start != null && was.s === "idle" ? { ...was, turn } // The turn's end arriving within it.
        : { s, at: now, turn };
      dirty = true;
    }
    if (!dirty) return;
    // Only ended agents lose their record: one missing from the list for a moment comes back to its place.
    const listed = new Set(list.map((a) => a.address));
    const ended = new Set(all.filter((k) => k.state !== "live").map((k) => k.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && (ended.has(k) || now - c.at > 30 * 86400000)) delete this.changed[k];
    localStorage.setItem("changes", JSON.stringify(this.changed));
  }

  // [wake ms, snoozed ms], or null.
  snoozedOf(addr, term) {
    const v = this.snoozing[addr] ?? term.get(addr)?.labels?.snoozed;
    return v ? v.split(":").map(Number) : null;
  }

  // Ends snoozes that are due, or whose agent (or one under it) needs the person: T3's raised hand. A due one is
  // news: on top of Active, marked Woke, and a notification that goes to it. Says whether any woke.
  wake(cx) {
    const now = Date.now(), all = terminals(), every = agents();
    const term = new Map(all.map((k) => [k.address, k])), listed = new Map(every.map((a) => [a.address, a.status]));
    let woke = false;
    for (const a of every) {
      const z = this.snoozedOf(a.address, term);
      if (!z) continue;
      const hand = a.status === "blocked" || this.descendants(all, a.address).some((k) => kidStatus(k, listed) === "blocked");
      if (z[0] > now && !hand) continue;
      this.setSnoozed(a.address, "", cx);
      this.changed[a.address] = { ...this.changed[a.address], at: now, start: null };
      this.leave(`arrive-${a.address}`, cx);
      if (!hand) {
        this.woke[a.address] = now;
        notify({ title: "Snooze over", body: `${namer()(a)}${a.space_name ? ` · ${a.space_name}` : ""}`,
          action: { name: "agent.focus", args: { terminal: a.address } } });
      }
      woke = true;
    }
    if (!woke) return false;
    for (const k of Object.keys(this.woke)) if (!term.has(k)) delete this.woke[k];
    localStorage.setItem("changes", JSON.stringify(this.changed));
    localStorage.setItem("woke", JSON.stringify(this.woke));
    return true;
  }

  // False on the first frame something is drawn, true after: draw it at its start values, then at its own.
  step(key, cx) {
    if (key.startsWith("in-")) this.used.add(key);
    if (key in this.motion) return this.motion[key];
    this.motion[key] = false;
    this.kick ??= cx.timer.after(16, (cx) => {
      this.kick = null;
      for (const k in this.motion) this.motion[k] = true;
      cx.notify();
    });
    return false;
  }

  // Something leaving or arriving for one motion's length; `done` runs once it's over.
  leave(key, cx, done = () => {}) {
    this.step(key, cx);
    // Started again before it ended (snoozed, woken, snoozed): the newer one ends it.
    this.ends ??= {};
    this.ends[key]?.cancel();
    this.ends[key] = cx.timer.after(EASE.duration + 40, (cx) => {
      delete this.ends[key];
      delete this.motion[key];
      done();
      cx.notify();
    });
  }

  descendants(all, addr) {
    return all.filter((k) => k.parent === addr && k.state === "live").flatMap((k) => [k, ...this.descendants(all, k.address)]);
  }

  // Asks gh about the branches the cards show (this.prWant, from render), PR_RUNS at a time, each again after PR_AGE.
  pumpPrs(cx) {
    for (const w of this.prWant ?? []) {
      const c = this.prs[w.key];
      if (this.prRuns >= PR_RUNS) return;
      if (c && (c.running || Date.now() - c.at < PR_AGE)) continue;
      this.prs[w.key] = { ...c, running: true };
      this.prRuns++;
      cx.spawn(async (cx) => {
        // No gh, not signed in, no PR: no badge, and nothing to say about it.
        const r = await exec("gh", ["pr", "view", w.branch, "--json", "number,state,isDraft,statusCheckRollup,url"], { cwd: w.cwd, on: w.on }).catch(() => null);
        let pr = null;
        try { if (r?.code === 0) pr = prOf(r.stdout); } catch { pr = null; }
        this.prs[w.key] = { at: Date.now(), pr };
        this.prRuns--;
        this.pumpPrs(cx);
        cx.notify();
      });
    }
  }

  // Types an agent reference into a terminal without pressing Enter (hc send would): focus it, then the clipboard
  // and the app's paste, and the old clipboard text back once the paste has read it.
  // Inserts close together keep the clipboard from before the first, not a reference. Only text comes back:
  // an image or copied files on the clipboard are replaced for good.
  // ponytail: 500ms is a guess at "the paste has read it"; a slow paste would get the old text instead.
  insertRef(text, where, cx) {
    if (!this.clipTimer) this.clip = cx.read_from_clipboard();
    this.refocus(where);
    cx.write_to_clipboard(text);
    run("terminal.paste");
    this.clipTimer?.cancel();
    this.clipTimer = cx.timer.after(500, (cx) => {
      if (this.clip !== undefined) cx.write_to_clipboard(this.clip);
      this.clip = this.clipTimer = undefined;
    });
  }

  // Disarms a reference (Esc, its 10s, a press elsewhere, or a drop); `restore` hands the keyboard back.
  unref(restore) {
    const back = this.refBack;
    this.refBack = null;
    if (!shared("focus.ref")) return;
    setShared("focus.ref", null);
    if (restore) this.refocus(back);
  }

  // Shown at once; the label comes back from the core a moment later.
  setSettled(addr, value, cx) { this.label(this.pending, "settled", addr, value, cx); }
  setSnoozed(addr, value, cx) { this.label(this.snoozing, "snoozed", addr, value, cx); }
  setUnread(addr, value, cx) { this.label(this.marking, "unread", addr, value, cx); }
  label(pending, key, addr, value, cx) {
    pending[addr] = value;
    cx.spawn(async (cx) => {
      const r = await hc(["label", addr, `${key}=${value}`]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code === 0) return;
      delete pending[addr];
      notify({ title: "Couldn't update the agent", body: r.stderr.trim(), level: "error" });
      cx.notify();
    });
  }

  // Ends a drag or sweep, and hands the keyboard back to the pane that had it, unless the drop moved on to
  // another agent. Not FocusHandle.release(): that frees the handle, and the next drag would throw.
  // `this.back` is set only once something lifted.
  endDrag(restore = true) {
    const back = restore ? this.back : null;
    this.drag = this.sweep = this.back = null;
    this.refocus(back);
    return null;
  }

  // Ends a selection, handing the keyboard back if `restore`.
  unselect(restore) {
    const back = restore ? this.selBack : null;
    this.selected.clear();
    this.anchor = this.selBack = null;
    this.refocus(back);
  }

  refocus(back) {
    if (back?.pane) run("pane.focus", { pane: back.pane });
    else if (back?.terminal) run("pane.focus", { terminal: back.terminal });
  }

  render(cx) {
    const t = theme(), now = Date.now();
    const every = agents(), all = terminals(), ps = panes(), sp = spaces();
    // A space that's gone reads as all; its id stays stored, so the scope returns with it.
    const scope = this.scope.filter((id) => sp.some((s) => s.id === id));
    const list = scope.length ? every.filter((a) => scope.includes(a.space)) : every;
    const listed = new Map(every.map((a) => [a.address, a.status]));
    const term = new Map(all.map((k) => [k.address, k]));
    for (const [k, v] of Object.entries(this.pending)) if (!term.has(k) || (term.get(k).labels?.settled ?? "") === v) delete this.pending[k];
    const settledAt = (a) => {
      const v = this.pending[a.address] ?? term.get(a.address)?.labels?.settled;
      return v ? v.split(":").map(Number) : null;
    };
    for (const [k, v] of Object.entries(this.snoozing)) if (!term.has(k) || (term.get(k).labels?.snoozed ?? "") === v) delete this.snoozing[k];
    this.wake(cx);
    const snoozedAt = (a) => this.snoozedOf(a.address, term);
    for (const [k, v] of Object.entries(this.marking)) if (!term.has(k) || (term.get(k).labels?.unread ?? "") === v) delete this.marking[k];
    const unread = (a) => Boolean(this.marking[a.address] ?? term.get(a.address)?.labels?.unread);
    // Looked at, a Woke mark has done its job.
    const viewed = every.find((a) => a.focused);
    // An unread mark too, once it comes into view: one marked while in view waits for the next look.
    if (viewed && viewed.address !== this.viewed && unread(viewed)) this.setUnread(viewed.address, "", cx);
    this.viewed = viewed?.address;
    if (viewed && this.woke[viewed.address]) {
      delete this.woke[viewed.address];
      localStorage.setItem("woke", JSON.stringify(this.woke));
    }
    const kids = new Map(every.map((a) => [a.address, this.descendants(all, a.address).map((k) => kidStatus(k, listed))]));
    // It, or anything under it, is working or needs the person.
    const busy = (a) => BUSY.has(a.status) || kids.get(a.address).some((s) => BUSY.has(s));
    // New work brings a settled agent back: busy now, or a turn ended since it was settled. Hidden ones too.
    for (const a of every) {
      const s = settledAt(a);
      if (s && (busy(a) || (term.get(a.address)?.turn ?? 0) > s[1])) this.setSettled(a.address, "", cx);
    }
    // The most urgent of it and what's under it.
    const state = (a) => [a.status, ...kids.get(a.address)].reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m));
    // Busy, or waiting on sub-agents it will hear back from; needing the person comes first.
    const running = (a) => state(a) !== "blocked" && (a.status === "working" || kids.get(a.address).includes("working"));
    // Pins are the agents list's (t3-agents), one set for both: pinned agents stay up top in pin order, whatever their state.
    const pins = shared("agents.pins") ?? [];
    this.track(every.map((a) => ({
      address: a.address, s: state(a) === "blocked" ? "blocked" : running(a) ? "working" : "idle",
      turn: term.get(a.address)?.turn ?? 0, excluded: pins.includes(a.address) || Boolean(settledAt(a)) || Boolean(snoozedAt(a)),
    })), all, now, cx);
    const mark = (a) => this.changed[a.address];
    // Seen changing, then; before that, the core's time of its last change. terminals() only has that as of
    // the app's start (status_ms isn't updated live), so it serves only until we see a change ourselves.
    const since = (a) => mark(a)?.at || term.get(a.address)?.status_ms || 0;
    // Just stopped: it shows its state now but keeps its Working place until the grace is out.
    const lingering = (a) => mark(a)?.s === "idle" && mark(a).start != null;
    // T3's Working shelf.
    const working = (a) => running(a) || lingering(a);
    // Active by when each came back to the person; Working by when its run started.
    const newest = (x, y) => since(y) - since(x) || byAddress(x, y);
    const begun = (a) => (lingering(a) ? mark(a).start || term.get(a.address)?.status_ms || 0 : since(a));
    // Working since: seen set going; before that, its own report, or for a parent waiting on sub-agents the
    // longest-working one's.
    const started = (a) => mark(a)?.at || (a.status === "working" ? term.get(a.address)?.status_ms
      : Math.min(Infinity, ...this.descendants(all, a.address).filter((k) => kidStatus(k, listed) === "working").map((k) => k.status_ms).filter(Boolean)));
    const pinned = pins.map((p) => list.find((a) => a.address === p)).filter((a) => a && !snoozedAt(a));
    // A card just snoozed keeps its place while it folds away.
    const rest = list.filter((a) => !pins.includes(a.address) && (!snoozedAt(a) || this.leaving[a.address]));
    // Snoozed, soonest to wake first, as T3's shelf.
    const zz = list.filter(snoozedAt).sort((x, y) => snoozedAt(x)[0] - snoozedAt(y)[0] || byAddress(x, y));
    // Rows that just left the shelf (woke, ended, filtered out) fold away where they were.
    const zNow = new Set(zz.map((a) => a.address));
    for (const p of this.prevZ ?? []) {
      if (zNow.has(p.a.address) || this.gone[p.a.address]) continue;
      this.gone[p.a.address] = p;
      this.leave(`out-${p.a.address}`, cx, () => delete this.gone[p.a.address]);
    }
    for (const k of Object.keys(this.gone)) if (zNow.has(k)) delete this.gone[k];
    this.prevZ = zz.map((a) => ({ a, z: snoozedAt(a) }));
    const zrows = [...this.prevZ, ...Object.values(this.gone)].sort((x, y) => x.z[0] - y.z[0] || byAddress(x.a, y.a));
    const out = rest.filter((a) => !settledAt(a) && !working(a)).sort(newest);
    const work = rest.filter((a) => !settledAt(a) && working(a)).sort((x, y) => begun(y) - begun(x) || byAddress(x, y));
    const put = rest.filter(settledAt).sort((x, y) => settledAt(y)[0] - settledAt(x)[0] || byAddress(x, y));
    // Shelves fold by default on this screen; the one in view stays out even folded or past the page, so it's never lost.
    const busyRows = this.workOpen ? work : work.filter((a) => a.focused);
    // The cards as they read: what Settle moves on through and cmd-1..9 jump to.
    const deck = [...pinned, ...out.filter((x) => !this.leaving[x.address]), ...busyRows];
    this.jump = (n) => deck[n - 1] && run("agent.focus", { terminal: deck[n - 1].address });
    // The PR badge's branches: each card's pane folder and branch (a new branch is a new key, asked at once).
    // ponytail: keyed by folder, not repo root; two panes in one repo's subfolders ask gh twice.
    const prWhere = (a) => {
      const p = ps.find((p) => p.pane === a.pane), on = a.address.includes("/") ? a.address.split("/")[0] : null;
      return p?.cwd && p.branch ? { key: `${on ?? ""}|${p.cwd}|${p.branch}`, cwd: p.cwd, branch: p.branch, on } : null;
    };
    this.prWant = deck.map(prWhere).filter(Boolean);
    // gh runs off render: a due branch starts a timer that starts the runs.
    const due = this.prWant.some((w) => !this.prs[w.key] || (!this.prs[w.key].running && now - this.prs[w.key].at >= PR_AGE));
    if (due && this.prRuns < PR_RUNS) this.prSoon ??= cx.timer.after(0, (cx) => { this.prSoon = null; this.pumpPrs(cx); });
    // A selection holds only cards; what an action acts on: the selection when the card is in it, else the card.
    for (const k of this.selected) if (!deck.some((a) => a.address === k)) this.selected.delete(k);
    const targets = (a) => this.selected.has(a.address) ? deck.filter((x) => this.selected.has(x.address)) : [a];
    // agent.next goes as the list reads. Only while this list shows: the agents list (t3-agents) sets its own.
    const find = (n) => n?.id === "sidebar-lists" ? n : (n?.children ?? []).map(find).find(Boolean);
    if (find(layout())?.active !== "lists") setAgentOrder([...new Set([...pinned, ...out, ...work, ...zz, ...put].map((a) => a.address))]);

    const title = namer();
    // What an agent is told about another: one line, with how to read it.
    const refText = (a) => {
      const dir = ps.find((p) => p.pane === a.pane)?.cwd, h = home();
      const where = !dir ? "" : ` · ${dir === h ? "~" : dir.startsWith(h + "/") ? "~" + dir.slice(h.length) : dir}`;
      return oneLine(`[agent ${a.address} "${title(a)}"${where} · read it with: hc read ${a.address}]`);
    };
    // T3's drag to reference: a row lifted out through the sidebar's right edge, toward the panes, arms a reference
    // the agents' pane headers (t3-pane) offer to take. The sidebar keeps the keyboard so Esc can disarm it.
    const armRef = (a, cx) => {
      const back = this.back, at = Date.now();
      this.endDrag(false);
      this.refBack = back;
      setShared("focus.ref", { address: a.address, title: title(a), text: refText(a), at });
      cx.timer.after(10000, (cx) => {
        if (shared("focus.ref")?.at === at) this.unref(true);
        cx.notify();
      });
    };
    const hover = (a) => (on, cx) => {
      if (on) this.hovered = a.address;
      else if (this.hovered === a.address) this.hovered = null;
      cx.notify();
    };
    // A button's icon and text brighten together: a hover style reaches the text but not the svg, so it's state.
    const glow = (id) => (on, cx) => {
      if (on) this.hot = id;
      else if (this.hot === id) this.hot = null;
      cx.notify();
    };
    const lit = (id, color) => (this.hot === id ? t.foreground : color);
    // Brought back, it's news again: the top of the list.
    const unsettle = (a, cx) => {
      this.setSettled(a.address, "", cx);
      this.changed[a.address] = { ...this.changed[a.address], at: Date.now(), start: null };
      localStorage.setItem("changes", JSON.stringify(this.changed));
    };
    // Settling the agent in view moves on to the next card down the list, from the top past the end, as T3 does;
    // one in the background moves nothing.
    const settle = (xs, cx) => {
      this.unselect(true);
      for (const a of xs) this.setSettled(a.address, `${Date.now()}:${term.get(a.address)?.turn ?? 0}`, cx);
      const i = deck.findIndex((a) => a.focused);
      if (i < 0 || !xs.includes(deck[i])) return false;
      const next = [...deck.slice(i + 1), ...deck.slice(0, i)].find((a) => !xs.includes(a));
      if (next) run("agent.focus", { terminal: next.address });
      return Boolean(next);
    };
    // Snoozing settles nothing: it puts the agent on its own shelf until `ms`. The one in view moves on as Settle does.
    // With a selection it snoozes every selected card that can be.
    const snoozeTo = this.snoozeTo = (addr, ms, cx) => {
      const a = every.find((x) => x.address === addr), xs = a ? targets(a).filter(canSnooze) : [];
      this.snoozeFor = null;
      this.hovered = null;
      if (!xs.length || !(ms > Date.now())) return;
      this.unselect(true);
      for (const a of xs) {
        if (settledAt(a)) this.setSettled(a.address, "", cx);
        this.setSnoozed(a.address, `${ms}:${Date.now()}`, cx);
        delete this.woke[a.address];
        // From Active it folds away while its row grows into the shelf below.
        if (out.includes(a)) {
          this.leaving[a.address] = true;
          this.leave(`out-card-${a.address}`, cx, () => delete this.leaving[a.address]);
        }
      }
      const i = deck.findIndex((x) => x.focused);
      if (i < 0 || !xs.includes(deck[i])) return;
      const next = [...deck.slice(i + 1), ...deck.slice(0, i)].find((x) => !xs.includes(x));
      if (next) run("agent.focus", { terminal: next.address });
    };
    // Woken by hand: back on top of Active, no notification.
    const unsnooze = (a, cx) => {
      this.setSnoozed(a.address, "", cx);
      this.leave(`arrive-${a.address}`, cx);
      this.changed[a.address] = { ...this.changed[a.address], at: Date.now(), start: null };
      localStorage.setItem("changes", JSON.stringify(this.changed));
    };
    // T3 won't snooze what needs the person; pins stay up top.
    const canSnooze = (a) => state(a) !== "blocked" && !pins.includes(a.address);
    // Finished and not pinned: what Settle takes.
    const settleable = (a) => !busy(a) && !pins.includes(a.address) && !settledAt(a);
    // Back in Active as finished and not yet seen; a settled or snoozed one comes back on top.
    const markUnread = (xs, cx) => {
      this.unselect(true);
      for (const a of xs) {
        if (settledAt(a)) unsettle(a, cx);
        else if (snoozedAt(a)) unsnooze(a, cx);
        this.setUnread(a.address, String(Date.now()), cx);
      }
    };

    // The settle key: the agent in view, as its card's Settle (finished, unpinned) or its settled row's undo.
    this.settleKey = (cx) => {
      const a = every.find((a) => a.focused);
      if (!a) return;
      if (settledAt(a)) unsettle(a, cx);
      else if (!busy(a) && !pins.includes(a.address)) settle([a], cx);
    };

    // Dragging, as T3's sidebar does it (Sidebar.drag.ts, Sidebar.pointer.ts). Press a row and move 6px to lift it;
    // it follows the pointer up and down inside the list and says what letting go will do. While it's lifted, the
    // Pinned and Active labels open, and the list opens a gap the size of the destination's row where it will
    // land. Pinned keeps a hand-made order; Active and Settled keep their own, so the gap opens where that puts it.
    let d = this.drag;
    // A row that leaves the list (its agent ended, a filter) can't be dropped. Render can't run commands, so
    // `this.back` stays and the release (or Esc, or leaving) hands the keyboard back.
    if (d && !list.some((a) => a.address === d.from)) d = this.drag = null;
    const dragging = Boolean(d?.moved);
    const lifted = dragging ? list.find((a) => a.address === d.from) : null;
    const sectionOf = (a) => pins.includes(a.address) ? "pinned" : settledAt(a) ? "settled" : working(a) ? "working" : "active";
    const from = lifted ? sectionOf(lifted) : null;
    const others = (xs) => xs.filter((x) => x.address !== d?.from);
    const pinTo = (before) => ({ section: "pinned", before: before ?? null });
    const pinOrder = (before) => {
      const kept = pins.filter((p) => p !== d.from), at = before ? kept.indexOf(before) : -1;
      kept.splice(at < 0 ? kept.length : at, 0, d.from);
      return kept;
    };
    // What letting go would do, and the gap that shows it: above a row (its address), after a section's last row
    // (`end-…`), right under an empty section's label (`head-…`), or none (a folded or busy destination).
    const plan = (() => {
      const to = lifted && d.target;
      if (!to || (to.section === from && from !== "pinned")) return null;
      if (to.section === "pinned") {
        const order = pinOrder(to.before);
        if (from === "pinned" && order.join("\n") === pins.join("\n")) return null;
        return { section: "pinned", order, gap: to.before ?? (others(pinned).length ? "end-pinned" : "head-pinned") };
      }
      // Busy work can't be settled (new work brings it straight back); out of Pinned it joins the Working shelf.
      if (busy(lifted)) return to.section === "settled" ? null : { section: "active", gap: null };
      if (to.section === "settled") return { section: "settled", gap: !this.open ? null : others(put)[0]?.address ?? "head-settled" };
      const rest = others(out), at = from === "settled" ? 0 : rest.filter((x) => newest(x, lifted) < 0).length;
      return { section: "active", gap: !rest.length ? "head-active" : rest[at]?.address ?? "end-active" };
    })();
    const target = dragging ? d.target?.section ?? null : null;
    // A section lights up as the target, as T3's labels and shelf header do.
    const hot = (s) => target === s && (Boolean(plan) || s === from);
    const verb = !plan ? null : plan.section === "pinned" ? (from === "pinned" ? null : "pin")
      : plan.section === "settled" ? "settle" : from === "pinned" ? "unpin" : from === "settled" ? "unsettle" : null;
    const BADGE = { pin: ["mods/workspace-chrome/pin.svg", "Pin"], unpin: ["mods/workspace-chrome/pin-off.svg", "Unpin"],
      settle: ["mods/workspace-chrome/circle-check.svg", "Settle"], unsettle: ["mods/t3-focus/undo.svg", "Un-settle"] };
    const badge = (v) => h_flex().id(`badge-${v}`).h(20).px(6).gap(4).flex_none().items_center().rounded(4)
      .border(1).border_color(t.accent + "66").bg(t.accent + "1a").text_size(11).font_medium().text_color(t.accent)
      .child(svg(BADGE[v][0]).size(12).flex_none().text_color(t.accent)).child(BADGE[v][1]);

    // Settled shows one page; while a drag moves a row out of it the next row fills in, and one settled into
    // it pushes the page's last row out of sight.
    const fromPage = from === "settled" && put.indexOf(lifted) < this.limit;
    const size = this.limit + (fromPage && plan ? 1 : 0) - (plan?.section === "settled" && from !== "settled" ? 1 : 0);
    const page = this.open ? put.slice(0, size) : [];
    const rows = [...page, ...put.filter((a) => a.focused && !page.includes(a))];

    const aim = (to, cx) => {
      if (!this.drag?.moved || JSON.stringify(this.drag.target ?? null) === JSON.stringify(to)) return;
      this.drag.target = to;
      cx.notify();
    };
    // Over a pin, the upper half drops above it and the lower half below.
    const pinNear = (a, upper) => {
      const xs = pinned.map((x) => x.address), i = xs.indexOf(a.address);
      return pinTo(xs.slice(upper && a.address !== d?.from ? i : i + 1).find((x) => x !== d?.from));
    };
    // The gap: a card and the list's 2px in Pinned and Active, a 30px slim row in Settled (stacked without gaps).
    const MOTION = { duration: 150, easing: "ease-out" };
    const cardH = lifted && from !== "settled" ? d.height : this.cardH ?? 82;
    const gap = (key) => div().id(`gap-${key}`).flex_none().h(plan?.gap !== key ? 0 : plan.section === "settled" ? 30 : cardH + 2)
      .when(dragging, (el) => el.transition("height", MOTION));
    // Each droppable row sits in a lane: the gap that opens above it, the row (folding away once the lifted one is
    // headed elsewhere, holding its place until then) with the list's spacing, and after the last, the end gap.
    const lane = (section, xs, draw, spacing) => xs.map((a, i) => v_flex().id(`lane-${a.address}`).flex_none()
      .child(gap(a.address))
      .child(v_flex().id(`hold-${a.address}`).flex_none()
        .when(dragging && d.from === a.address, (el) => el.overflow_hidden().opacity(0).h(plan ? 0 : d.height + spacing).transition("height", MOTION))
        // Snoozed out of the list it folds away; woken back into it, it unfolds.
        .when(Boolean(this.leaving[a.address]) || `arrive-${a.address}` in this.motion, (el) => {
          const out = Boolean(this.leaving[a.address]), moving = this.motion[out ? `out-card-${a.address}` : `arrive-${a.address}`];
          const open = out ? !moving : moving;
          return el.overflow_hidden().h(open ? (this.heights[a.address] ?? this.cardH ?? 82) + spacing : 0).opacity(open ? 1 : 0)
            .transition("height", EASE).transition("opacity", EASE);
        })
        .child(draw(a)).when(spacing > 0, (el) => el.child(div().h(spacing).flex_none())))
      .when(i === xs.length - 1, (el) => el.child(gap(`end-${section}`))));
    // T3's boundaries: Pinned and Active labels, shown only while dragging; the list opens room for them.
    const boundary = (id, text, section, to) => h_flex().id(id).flex_none().overflow_hidden().h(dragging ? 24 : 0)
      .transition("height", MOTION).px(10).gap(8).items_center().text_size(12).font_medium()
      .on_mouse_move((_e, cx) => aim(to, cx))
      .when(dragging, (el) => el.child(div().text_color(hot(section) ? t.accent : t.muted).child(text))
        .child(div().flex_1().h(1).bg(hot(section) ? t.accent + "80" : t.border)));
    // An empty section still takes a drop: T3's dashed placeholder, accent while it's the target.
    const placeholder = (section, text) => div().id(`${section}-placeholder`).h(36).mb(2).flex_none().flex().items_center().justify_center()
      .rounded(6).border(1).border_dashed().text_size(12)
      .border_color(hot(section) ? t.accent + "66" : t.border).text_color(hot(section) ? t.accent : t.muted)
      .when(hot(section), (el) => el.bg(t.accent + "0d"))
      .on_mouse_move((_e, cx) => aim({ section }, cx))
      .child(text);
    // Picked up anywhere on a row that can move (not Working, not one whose Settle is still on its way).
    // Right-clicked, it opens the menu where the pointer is.
    const row = (el, a) => el
      .on_mouse_down("right", (_e, cx) => { this.menu = { for: a.address, at: this.pointer }; this.picking = false; cx.notify(); })
      .on_mouse_down("left", (e) => {
        if (sectionOf(a) === "working" || this.pending[a.address] !== undefined) return;
        this.drag = { from: a.address, at: e.position, grab: e.local_position?.y ?? 0, height: e.bounds?.height ?? 0, moved: false, target: null };
      })
      .on_mouse_move((e, cx) => {
        if (this.sweep?.moved) return sweepTo(a, cx);
        const s = sectionOf(a);
        aim(s === "pinned" ? pinNear(a, (e.local_position?.y ?? 0) < (e.bounds?.height ?? 0) / 2) : s === "working" ? null : { section: s }, cx);
      });
    // A drag's or sweep's release doesn't also click the row or button it ends on.
    const justDropped = () => this.drag?.moved || this.sweep?.moved || Date.now() - (this.dropped ?? 0) < 250;
    // cmd-click toggles a card in the selection, shift-click adds the run from the anchor, as T3's; a plain
    // click ends the selection.
    const open = (a) => (e, cx) => {
      if (justDropped()) return;
      const keys = deck.map((x) => x.address), i = keys.indexOf(this.anchor), j = keys.indexOf(a.address);
      if (j < 0 || !(e.modifiers.platform || e.modifiers.shift)) {
        this.unselect(false);
        return run("agent.focus", { terminal: a.address });
      }
      if (e.modifiers.platform && this.selected.has(a.address)) this.selected.delete(a.address);
      else if (e.modifiers.platform || i < 0) {
        this.selected.add(a.address);
        this.anchor = a.address;
      } else for (const k of keys.slice(Math.min(i, j), Math.max(i, j) + 1)) this.selected.add(k);
      if (!this.selected.size) this.unselect(true);
      else if (!this.selBack) { this.selBack = focused() ?? {}; this.keys.focus(); }
      cx.notify();
    };
    // Says whether it moved on to another agent.
    const drop = (cx) => {
      if (!plan) return false;
      const a = lifted;
      if (plan.section === "pinned") setShared("agents.pins", plan.order);
      else if (pins.includes(a.address)) setShared("agents.pins", pins.filter((p) => p !== a.address));
      if (plan.section === "settled") return settle([a], cx);
      if (settledAt(a)) unsettle(a, cx);
      return false;
    };

    // Sweep, T3's other drag: press a card's Settle (or a settled row's undo) and move across rows to take the
    // whole run along; letting go settles (or brings back) every row it marked.
    const sweepFrom = (action, a) => (e, cx) => {
      cx.stop_propagation();
      this.sweep = { action, origin: a.address, at: e.position, moved: false, keys: [a.address] };
    };
    const sweepList = () => this.sweep.action === "settle" ? out.filter((x) => !busy(x)) : rows;
    const sweepTo = (a, cx) => {
      const xs = sweepList().map((x) => x.address), i = xs.indexOf(this.sweep.origin), j = xs.indexOf(a.address);
      if (i < 0 || j < 0) return;
      const keys = xs.slice(Math.min(i, j), Math.max(i, j) + 1);
      if (keys.join("\n") === this.sweep.keys.join("\n")) return;
      this.sweep.keys = keys;
      cx.notify();
    };
    const swept = (a) => Boolean(this.sweep?.moved && this.sweep.keys.includes(a.address));
    const finish = (cx) => {
      if (!this.drag && !this.sweep && !this.back) return;
      const moved = (dragging && drop(cx)) || (Boolean(this.sweep?.moved) && applySweep(cx));
      if (dragging || this.sweep?.moved) this.dropped = Date.now();
      this.endDrag(!moved);
    };
    const applySweep = (cx) => {
      const xs = sweepList().filter((x) => this.sweep.keys.includes(x.address));
      if (this.sweep.action === "settle") return settle(xs, cx);
      for (const a of xs) unsettle(a, cx);
      return false;
    };

    // The card's snooze button and T3's menu: the presets with their wake times, then a typed time.
    const snoozeMenu = (a) => {
      const id = `snooze-${a.address}`;
      const menuIn = this.snoozeFor === a.address && this.step(`in-menu-${a.address}`, cx);
      const choice = ([label, ms]) => h_flex().id(`${id}-${label}`).h(30).px(8).gap(8).flex_none().items_center().rounded(6)
        .hover((s) => s.bg(t.hover)).role("button").accessibility_label(`Snooze ${label.toLowerCase()}`)
        .on_click((_e, cx) => { cx.stop_propagation(); snoozeTo(a.address, ms, cx); cx.notify(); })
        .child(div().flex_1().text_color(t.foreground).child(label))
        .child(div().text_size(12).text_color(t.dim).child(wakes(ms, now)));
      return Popover.new(`${id}-menu`).anchor("top_right").open(this.snoozeFor === a.address)
        .on_open_change((open, cx) => {
          this.snoozeFor = open ? a.address : null;
          this.picking = false;
          if (open) this.snoozeInput.set_value("");
          cx.notify();
        })
        .trigger(h_flex().id(id).h(20).px(4).flex_none().items_center().rounded(4)
          .opacity(this.step(`in-${id}`, cx) ? 1 : 0).transition("opacity", FADE)
          .on_hover(glow(id)).role("button").accessibility_label("Snooze")
          .on_click((_e, cx) => cx.stop_propagation())
          .child(svg("mods/workspace-chrome/clock.svg").size(12).flex_none().text_color(lit(id, t.muted))))
        .content(v_flex().id(`${id}-panel`).w(240).mt(4).p(6).gap(2).rounded(10)
          .opacity(menuIn ? 1 : 0).transition("opacity", FADE)
          .bg(t.popover).border_1().border_color(t.border).text_size(13)
          .on_click((_e, cx) => cx.stop_propagation())
          .when(this.picking, (el) => el.child(picker(a)))
          .when(!this.picking, (el) => el
            .child(div().px(8).py(4).text_size(12).font_medium().text_color(t.dim).child("Snooze until"))
            .children(presets(now).map(choice))
            .child(pickItem(`${id}-pick`))
            .child(h_flex().h(32).mt(4).px(8).gap(8).flex_none().items_center().border_t_1().border_color(t.border)
              .child(svg("mods/workspace-chrome/clock.svg").size(14).flex_none().text_color(t.dim))
              .child(Input.new(this.snoozeInput).flex_1().h_full().text_size(13).text_color(t.foreground)))));
    };
    // Opens the picker in place of the menu it's in.
    const pickItem = (id) => h_flex().id(id).h(30).px(8).gap(8).flex_none().items_center().rounded(6)
      .hover((s) => s.bg(t.hover)).role("button").accessibility_label("Pick date and time")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.picking = true;
        this.calendar.set_value(null);
        this.wakeTime.set_value("9:00");
        cx.notify();
      })
      .child(div().flex_1().text_color(t.foreground).child("Pick date & time…"));
    // T3's custom snooze: a month (past days off, no going back past this one), a time on the picked day (9:00
    // unless typed), and Snooze, which stays off until the two make a time still ahead.
    const picker = (a) => {
      const c = this.calendar, today = c.today(), day = c.value(), id = `pick-${a.address}`;
      const ms = typeof day === "string" ? parseWake(`${day} ${this.wakeTime.value().trim() || "9:00"}`, now) : null;
      const local = (d) => new Date(+d.slice(0, 4), d.slice(5, 7) - 1, +d.slice(8));
      const grid = c.month_days()[0] ?? [], first = c.year() * 12 + c.month() <= +today.slice(0, 4) * 12 + +today.slice(5, 7);
      const turn = (dir, icon, label, off) => h_flex().id(`${id}-${dir}`).size(24).flex_none().items_center().justify_center().rounded(6)
        .role("button").accessibility_label(label)
        .when(off, (el) => el.opacity(0.3))
        .when(!off, (el) => el.hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
          cx.stop_propagation();
          dir === "prev" ? c.prev_month() : c.next_month();
          cx.notify();
        }))
        .child(svg(`mods/workspace-chrome/${icon}.svg`).size(12).text_color(t.muted));
      const cell = (d) => {
        const past = d < today, picked = d === day, other = +d.slice(5, 7) !== c.month();
        return h_flex().id(`${id}-${d}`).size(28).flex_none().items_center().justify_center().rounded(6).text_size(12)
          .text_color(picked ? t.accent_foreground : other ? t.dim : t.foreground)
          .when(picked, (el) => el.bg(t.accent))
          .when(d === today && !picked, (el) => el.border(1).border_color(t.border))
          .when(past, (el) => el.opacity(0.35))
          .when(!past && !picked, (el) => el.hover((s) => s.bg(t.hover)))
          .when(!past, (el) => el.role("button").accessibility_label(local(d).toDateString()).on_click((_e, cx) => {
            cx.stop_propagation();
            c.set_value(d);
            cx.notify();
          }))
          .child(String(+d.slice(8)));
      };
      return v_flex().id(id).gap(2).opacity(this.step(`in-${id}`, cx) ? 1 : 0).transition("opacity", FADE)
        .child(h_flex().h(28).px(4).gap(4).flex_none().items_center()
          .child(div().flex_1().px(4).text_size(12).font_medium().text_color(t.foreground).child(`${MONTHS[c.month() - 1]} ${c.year()}`))
          .child(turn("prev", "chevron-left", "Previous month", first))
          .child(turn("next", "chevron-right", "Next month", false)))
        .child(h_flex().px(2).justify_between().children((grid[0] ?? []).map((d) =>
          div().w(28).flex_none().text_center().text_size(11).text_color(t.dim).child(DAYS[local(d).getDay()].slice(0, 2)))))
        .children(grid.map((week, i) => h_flex().id(`${id}-week-${i}`).px(2).justify_between().children(week.map(cell))))
        .child(h_flex().h(36).mt(4).px(4).gap(8).flex_none().items_center().border_t_1().border_color(t.border)
          .child(svg("mods/workspace-chrome/clock.svg").size(14).flex_none().text_color(t.dim))
          .child(Input.new(this.wakeTime).flex_1().h_full().text_size(13).text_color(t.foreground))
          .child(h_flex().id(`${id}-go`).h(26).px(10).flex_none().items_center().rounded(6).text_size(12).font_medium()
            .bg(t.solid).text_color(t.solid_foreground).role("button").accessibility_label(ms ? `Snooze until ${wakes(ms, now)}` : "Snooze")
            .when(!ms, (el) => el.opacity(0.4))
            .when(Boolean(ms), (el) => el.on_click((_e, cx) => {
              cx.stop_propagation();
              snoozeTo(a.address, ms, cx);
              this.menu = null;
              this.picking = false;
              cx.notify();
            }))
            .child("Snooze")));
    };

    // T3's right-click menu: Mark unread, and the row's own actions where they're one step.
    const menuItem = (id, label, fn, extra) => h_flex().id(`menu-${id}`).h(30).px(8).gap(8).flex_none().items_center().rounded(6)
      .hover((s) => s.bg(t.hover)).role("button").accessibility_label(label)
      .on_click((_e, cx) => { cx.stop_propagation(); this.menu = null; this.hovered = null; fn(cx); this.unselect(true); cx.notify(); })
      .child(div().flex_1().text_color(t.foreground).child(label))
      .when(Boolean(extra), (el) => el.child(div().text_size(12).text_color(t.dim).child(extra)));
    const menuItems = (() => {
      const a = this.menu && list.find((x) => x.address === this.menu.for);
      if (!a) return this.menu = null;
      const xs = targets(a), n = xs.length > 1 ? ` (${xs.length})` : "", has = (x) => pins.includes(x.address);
      const fresh = xs.filter((x) => !busy(x)), settles = xs.filter(settleable), dozy = xs.filter(canSnooze);
      if (this.picking && dozy.length) return [picker(a)];
      return [
        fresh.length > 0 && menuItem("unread", `Mark unread${n}`, (cx) => markUnread(fresh, cx)),
        // The drag's reference without the drag: into the agent in view.
        xs.length === 1 && focused()?.terminal && focused().terminal !== a.address
          && menuItem("reference", "Reference in focused agent", (cx) => this.insertRef(refText(a), focused(), cx)),
        xs.every(has) ? menuItem("unpin", `Unpin${n}`, () => setShared("agents.pins", pins.filter((p) => !xs.some((x) => x.address === p))))
          : menuItem("pin", `Pin${n}`, (cx) => {
            setShared("agents.pins", [...pins, ...xs.filter((x) => !has(x)).map((x) => x.address)]);
            for (const x of xs.filter(settledAt)) unsettle(x, cx);
          }),
        settles.length > 0 ? menuItem("settle", `Settle${n}`, (cx) => settle(settles, cx))
          : xs.every(settledAt) && menuItem("unsettle", `Un-settle${n}`, (cx) => { for (const x of xs) unsettle(x, cx); }),
        ...(dozy.length ? [div().mt(4).px(8).py(4).border_t_1().border_color(t.border).text_size(12).font_medium().text_color(t.dim).child("Snooze until"),
          ...presets(now).map(([label, ms]) => menuItem(`snooze-${label}`, label, (cx) => snoozeTo(a.address, ms, cx), wakes(ms, now))),
          pickItem("menu-pick")] : []),
      ].filter(Boolean);
    })();

    // A snoozed row: one dim line with its wake time; hovered, the time becomes a wake-now arrow. Viewing it
    // leaves it snoozed.
    const doze = (a, z) => {
      const on = a.focused, over = !dragging && this.hovered === a.address, bright = on || over;
      const pic = icon(a.program, 14, t.dim), id = `unsnooze-${a.address}`;
      const undo = h_flex().id(id).size(20).flex_none().items_center().justify_center().rounded(4)
        .on_hover(glow(id)).role("button").accessibility_label("Wake now")
        .on_click((_e, cx) => { cx.stop_propagation(); this.hovered = null; unsnooze(a, cx); cx.notify(); })
        .child(svg("mods/t3-focus/undo.svg").size(14).flex_none().text_color(lit(id, t.muted)));
      return h_flex().id(`doze-${a.address}`).h(30).px(10).gap(8).flex_none().items_center().rounded(8)
        .role("button").accessibility_label(title(a)).on_hover(hover(a)).on_click(open(a))
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .child(h_flex().size(16).flex_none().items_center().justify_center().opacity(bright ? 1 : 0.5).when(Boolean(pic), (el) => el.child(pic)))
        .child(div().flex_1().min_w(0).truncate().text_color(bright ? t.foreground : t.muted).child(title(a)))
        .child(over ? undo : div().flex_none().text_size(12).text_color(t.dim).child(wakes(z[0], now)));
    };
    // Each shelf row grows in when snoozed, folds with the shelf (the one in view stays out), and folds away when
    // it leaves.
    const dozeLane = ({ a, z }) => {
      const entered = this.step(`in-z-${a.address}`, cx), left = this.gone[a.address] ? this.motion[`out-${a.address}`] !== false : false;
      const open = entered && !left && (this.dozeOpen || a.focused);
      return div().id(`zlane-${a.address}`).flex_none().overflow_hidden().h(open ? 30 : 0).opacity(open ? 1 : 0)
        .transition("height", EASE).transition("opacity", EASE).child(doze(a, z));
    };

    // T3's PR badge: the number in its state's color, then its checks; a click opens the PR.
    const PR_TONE = { open: "ansi2", draft: "dim", merged: "ansi5", closed: "ansi1" };
    const prBadge = (a, pr) => h_flex().id(`pr-${a.address}`).h(16).px(4).gap(3).flex_none().items_center().rounded(4)
      .text_color(t[PR_TONE[pr.state]] ?? t.dim).hover((s) => s.bg(t.hover))
      .role("button").accessibility_label(`Pull request #${pr.number}, ${pr.state}${pr.ci ? `, checks ${pr.ci}` : ""}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(pr.url); })
      .child(`#${pr.number}`)
      .when(pr.ci === "passing", (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10).flex_none().text_color(t.ansi2)))
      .when(pr.ci === "failing", (el) => el.child(svg("mods/pane/close.svg").size(10).flex_none().text_color(t.ansi1)))
      .when(pr.ci === "pending", (el) => el.child(div().size(6).flex_none().rounded_full().bg(t.working)));

    // `ghost`: the copy that follows the pointer, drawn without handlers or ids the list already uses.
    const card = (a, ghost) => {
      const st = state(a), on = a.focused;
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const branch = ps.find((p) => p.pane === a.pane)?.branch;
      const going = kids.get(a.address).filter((s) => s === "working").length;
      const meta = [branch, going ? `${going} sub-agent${going > 1 ? "s" : ""} working` : null].filter(Boolean).join(" · ");
      const pic = icon(a.program, 16, t.muted), jumpN = deck.indexOf(a) + 1, pr = !ghost && this.prs[prWhere(a)?.key]?.pr;
      // Hovered, the corner offers Settle, but only for what's finished: a working or stuck tree stays in sight.
      const offer = !dragging && !this.sweep?.moved && this.hovered === a.address && !busy(a) && !pins.includes(a.address);
      const snoozable = !ghost && !dragging && !this.sweep?.moved && canSnooze(a) && (this.hovered === a.address || this.snoozeFor === a.address);
      const id = `settle-${a.address}`;
      // As in T3, the corner says the state when there's one worth saying (Working, Needs you, Done: finished
      // and not yet seen), else how long ago it last changed. Sized as T3's: 16px mark, 4px gaps, and the
      // time a separate monospace child, so spacing and width don't hang on the interface font.
      const pill = (color, mark, label, time) => h_flex().id(`state-${a.address}`).h(20).gap(4).flex_none().items_center().font_medium().text_color(color)
        .child(mark).child(div().child(label))
        .when(Boolean(time), (el) => el.child(div().font_family(settings().font_family ?? "JetBrains Mono").child(time)));
      // Lifted, or marked by a sweep, the corner says what letting go will do instead.
      const corner = ghost ? (verb ? badge(verb) : div())
        : swept(a) ? badge("settle")
        : offer
        ? h_flex().id(id).h(20).px(6).gap(4).flex_none().items_center().rounded(6)
          .text_size(12).text_color(lit(id, t.muted)).on_hover(glow(id))
          .role("button").accessibility_label("Settle")
          .on_mouse_down("left", sweepFrom("settle", a))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (justDropped()) return;
            // A click is no sweep. Its release stops here, so the sidebar's mouse-up won't end the one the press began.
            this.sweep = null;
            // The card moves away without a pointer-leave event.
            this.hovered = null;
            settle(targets(a).filter(settleable), cx);
            cx.notify();
          })
          .child(svg("mods/workspace-chrome/check.svg").size(12).flex_none().text_color(lit(id, t.muted)))
          .child("Settle")
        : running(a)
          ? pill(t.working, svg("mods/workspace-chrome/spinner.svg").size(16).flex_none().text_color(t.working).spin(900),
            "Working", started(a) > 0 && started(a) < Infinity ? took(started(a), now) : null)
          : st === "blocked"
            ? pill(t.blocked, div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(11).font_bold().flex().items_center().justify_center().child("!"), "Needs you")
            : this.woke[a.address]
              ? pill(t.accent, svg("mods/workspace-chrome/clock.svg").size(14).flex_none().text_color(t.accent)
                .loop("opacity", { from: 0.45, to: 1, period: 1600 }), "Woke")
            : st === "done" || unread(a)
              ? pill(t.ansi2, svg("mods/workspace-chrome/circle-check.svg").size(16).flex_none().text_color(t.ansi2), "Done")
              : div().id(`state-${a.address}`).flex_none().child(since(a) > 0 ? ago(since(a), now) : "");
      const base = v_flex().id(`${ghost ? "ghost-" : ""}card-${a.address}`).px(10).py(8).gap(2).flex_none().rounded(10);
      return (ghost ? base : row(base, a).role("button").accessibility_label(title(a)).on_hover(hover(a))
        // agent.focus, not pane.focus: in tabs it focuses the pane, and it picks what the agent view shows.
        .on_click(open(a)).on_size_change((size) => { this.cardH = this.heights[a.address] = size.height; }))
        .when(on, (el) => el.bg(t.selected))
        .when(!on && !ghost && !dragging && !this.sweep?.moved, (el) => el.hover((s) => s.bg(t.hover)))
        .when(!ghost && this.selected.has(a.address), (el) => el.bg(t.accent + "26"))
        .child(h_flex().h(20).gap(6).items_center().text_size(12).text_color(t.dim)
          .child(avatar(a.space, a.space_name, 14, 4))
          // Lifted, a pin keeps its glyph only while it stays among the pins.
          .when(pins.includes(a.address) && (!ghost || plan?.section === "pinned" || !plan), (el) => el.child(svg("mods/workspace-chrome/pin.svg").size(12).flex_none().text_color(t.dim)))
          .child(div().flex_1().min_w(0).truncate().child(machine ? `${a.space_name} · ${machine}` : a.space_name ?? ""))
          .when(snoozable, (el) => el.child(snoozeMenu(a)))
          .child(corner))
        .child(h_flex().gap(8).items_center()
          // Only the one in view is bright, as in T3.
          .child(div().flex_1().min_w(0).truncate().text_size(14).text_color(on ? t.foreground : t.muted).child(title(a)))
          // T3's jump hint, shown on hover: the sidebar never holds the keyboard, so it can't see cmd held.
          .when(!ghost && !dragging && this.hovered === a.address && jumpN > 0 && jumpN <= 9, (el) => el.child(
            div().id(`jump-${a.address}`).h(16).px(4).flex_none().flex().items_center().rounded(4).border(1).border_color(t.border)
              .text_size(11).text_color(t.dim).font_family(settings().font_family ?? "JetBrains Mono").child(`⌘${jumpN}`)))
          .when(Boolean(pic), (el) => el.child(pic)))
        .when(Boolean(meta || pr), (el) => el.child(h_flex().min_w(0).gap(6).items_center().text_size(12).text_color(t.dim)
          .when(Boolean(pr), (el) => el.child(prBadge(a, pr)))
          .child(div().min_w(0).truncate().child(meta))));
    };

    // A settled row: one dim line; viewing it leaves it settled. Hovered it brightens and its time
    // becomes a bare undo arrow, as in T3.
    const slim = (a, ghost) => {
      const on = a.focused, over = !dragging && !this.sweep?.moved && this.hovered === a.address, bright = on || over || ghost || swept(a);
      const pic = icon(a.program, 14, t.dim);
      const undo = h_flex().id(`unsettle-${a.address}`).size(20).flex_none().items_center().justify_center().rounded(4)
        .on_hover(glow(`unsettle-${a.address}`))
        .role("button").accessibility_label("Unsettle")
        .on_mouse_down("left", sweepFrom("unsettle", a))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (justDropped()) return;
          this.sweep = null;
          this.hovered = null;
          unsettle(a, cx);
          cx.notify();
        })
        .child(svg("mods/t3-focus/undo.svg").size(14).flex_none().text_color(lit(`unsettle-${a.address}`, t.muted)));
      const base = h_flex().id(`${ghost ? "ghost-" : ""}slim-${a.address}`).h(30).px(10).gap(8).flex_none().items_center().rounded(8);
      return (ghost ? base : row(base, a).role("button").accessibility_label(title(a)).on_hover(hover(a)).on_click(open(a)))
        .when(on, (el) => el.bg(t.selected))
        .when(!on && !ghost && !dragging && !this.sweep?.moved, (el) => el.hover((s) => s.bg(t.hover)))
        .child(h_flex().size(16).flex_none().items_center().justify_center().opacity(bright ? 1 : 0.5).when(Boolean(pic), (el) => el.child(pic)))
        .child(div().flex_1().min_w(0).truncate().text_color(bright ? t.foreground : t.muted).child(title(a)))
        .child(ghost ? (verb ? badge(verb) : div()) : swept(a) ? badge("unsettle")
          : over ? undo : div().flex_none().text_size(12).text_color(t.dim).child(ago(settledAt(a)[0], now)));
    };

    // A shelf's header, folding it: label, then count and chevron at the far edge.
    const shelf = (id, label, count, open, toggle, extra) => h_flex().id(id).h(30).px(10).gap(6).flex_none().items_center()
      .text_size(12).font_medium().text_color(t.dim)
      .role("button").accessibility_label(`${open ? "Hide" : "Show"} ${label.toLowerCase()} agents`)
      .on_click((_e, cx) => {
        toggle();
        cx.notify();
      })
      .child(div().flex_1().child(label))
      .when(Boolean(extra), (el) => el.child(extra))
      .child(div().child(String(count)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none());

    this.ticking = busyRows.length > 0 || pinned.some(working);
    // The first shelf takes the free space above it, so both sit at the bottom.
    const shelves = v_flex().id("shelves").pt(12).flex_none()
      .when(work.length > 0, (el) => el
        .child(shelf("working-header", "Working", work.length, this.workOpen, () => {
          this.workOpen = !this.workOpen;
          localStorage.setItem("working-open", String(this.workOpen));
        }).on_mouse_move((_e, cx) => aim(null, cx)))
        .child(v_flex().gap(2).children(busyRows.map((a) => card(a)))))
      .when(zrows.length > 0, (el) => el
        .child(shelf("snoozed-header", "Snoozed", zz.length, this.dozeOpen, () => {
          this.dozeOpen = !this.dozeOpen;
          localStorage.setItem("snoozed-open", String(this.dozeOpen));
        }).on_mouse_move((_e, cx) => aim(null, cx)))
        .children(zrows.map(dozeLane)));
    // Clear closes settled agents' panes; Herdr then closes emptied tabs. The one in view stays.
    const spaceNow = sp.find((s) => s.active), tabNow = spaceNow?.tabs.find((c) => c.active)?.id;
    const doomed = put.filter((a) => a.pane && !a.focused && a.tab !== tabNow);
    // With nothing to clear the button goes, and a gone element hears no pointer-leave: drop its ask and hover.
    if (doomed.length === 0) {
      this.clearing = false;
      if (this.hot === "settled-clear") this.hot = null;
    }
    // The ask ends a moment after the pointer leaves the button, or after 3s if the pointer never came (keyboard).
    const unask = (ms, cx) => {
      this.unask?.cancel();
      this.unask = ms > 0 ? cx.timer.after(ms, (cx) => { this.clearing = false; cx.notify(); }) : null;
    };
    const clear = (cx) => {
      if (!this.clearing) {
        this.clearing = true;
        unask(this.hot === "settled-clear" ? 0 : 3000, cx);
        return;
      }
      this.clearing = false;
      unask(0, cx);
      const gone = new Set(doomed.map((a) => a.pane));
      for (const id of new Set(doomed.map((a) => a.space))) {
        const s = sp.find((s) => s.id === id), tabs = s?.tabs.map((c) => c.id) ?? [];
        const mine = ps.filter((p) => tabs.includes(p.tab));
        // The space stays: pane.close refuses its last pane, so a space left empty gets a fresh shell tab first,
        // where its terminals are now: an unnamed space is named after that, and s.folder is only where it began.
        if (mine.every((p) => gone.has(p.pane))) run("tab.new", { space: id, folder: mine.find((p) => p.cwd)?.cwd || s.folder });
        for (const a of doomed.filter((a) => a.space === id)) run("pane.close", { pane: a.pane });
      }
      // tab.new shows the new tab; go back to where the person was.
      if (tabNow) { run("space.select", { id: spaceNow.id }); run("tab.select", { id: tabNow }); }
    };
    const clearButton = doomed.length > 0 && h_flex().id("settled-clear").h(20).px(6).flex_none().items_center().rounded(4)
      .text_color(this.clearing ? t.blocked : lit("settled-clear", t.dim)).on_hover((on, cx) => {
        if (this.clearing) unask(on ? 0 : 400, cx);
        glow("settled-clear")(on, cx);
      })
      .role("button").accessibility_label(this.clearing ? `Close ${doomed.length} settled agents` : "Clear settled agents")
      .on_click((e, cx) => {
        cx.stop_propagation();
        // A double-click only asks: the second click of it never answers.
        if (this.clearing && e.click_count > 1) return;
        clear(cx);
        cx.notify();
      })
      .child(this.clearing ? `Clear ${doomed.length}?` : "Clear");
    const tail = v_flex().id("settled").flex_none()
      .child(shelf("settled-header", "Settled", put.length, this.open, () => {
        this.open = !this.open;
        this.limit = FIRST;
        localStorage.setItem("open", String(this.open));
      }, clearButton).on_mouse_move((_e, cx) => aim({ section: "settled" }, cx))
        // As T3's shelf header: brighter while anything is lifted, accent as the target.
        .when(dragging, (el) => el.text_color(hot("settled") ? t.accent : t.foreground)))
      .when(dragging && others(rows).length === 0 && !(rows.length > 0 && !plan), (el) => el
        .child(plan?.gap === "head-settled" ? gap("head-settled") : placeholder("settled", "Settled")))
      .children(lane("settled", rows, (a) => slim(a), 0))
      .when(this.open && put.length > this.limit, (el) => el.child(h_flex().id("settled-more").h(30).px(10).gap(8).flex_none().items_center().rounded(8)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .role("button").accessibility_label("Show more settled agents")
        .on_click((_e, cx) => {
          this.limit += MORE;
          cx.notify();
        })
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none())
        .child(`Show ${Math.min(MORE, put.length - this.limit)} more`)));

    // T3's top row: search on the left, then the space filter, new space and new agent.
    const tool = (id, label, icon, fn) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .hover((s) => s.bg(t.hover)).on_hover(glow(id))
      .role("button").accessibility_label(label).on_click(fn)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).text_color(lit(id, t.dim)));
    // The filter shows what it filters to: one avatar, two overlapping, or the plain filter icon.
    const scoped = sp.filter((s) => scope.includes(s.id));
    const choice = (s) => {
      const on = s.id ? scope.includes(s.id) : scope.length === 0;
      // Selection is a check badge on the icon, as in T3.
      return h_flex().id(`scope-${s.id ?? "all"}`).h(32).px(8).gap(10).flex_none().items_center().rounded(6)
        .hover((st) => st.bg(t.hover))
        .role("button").accessibility_label(s.name)
        .on_click((e, cx) => this.pick(s, e.modifiers.shift, cx))
        .child(div().relative().flex_none()
          .child(s.id ? avatar(s.id, s.name, 16, 4) : svg("mods/workspace-chrome/folder.svg").size(16).text_color(t.muted))
          .when(on, (el) => el.child(h_flex().absolute().right(-4).bottom(-4).size(12).rounded_full().bg(t.accent)
            .border(2).border_color(t.popover).items_center().justify_center()
            .child(svg("mods/workspace-chrome/check.svg").size(7).text_color("#ffffff")))))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name));
    };
    const filter = Popover.new("focus-scope-menu").anchor("top_right").open(this.scopeOpen)
      .on_open_change((open, cx) => {
        this.scopeOpen = open;
        if (open) {
          this.search.set_value("");
          this.search.focus();
        }
        cx.notify();
      })
      .trigger(h_flex().id("focus-scope").size(26).flex_none().items_center().justify_center().rounded(6)
        .hover((s) => s.bg(t.hover)).on_hover(glow("focus-scope"))
        .role("button").accessibility_label(scoped.length ? `Filter by space: ${scoped.map((s) => s.name).join(", ")}` : "Filter by space")
        .child(scoped.length > 1
          ? h_flex().children(scoped.slice(0, 2).map((s, i) => avatar(s.id, s.name, 14, 4).when(i > 0, (el) => el.ml(-6))))
          : scoped.length
            ? avatar(scoped[0].id, scoped[0].name, 16, 4)
            : svg("mods/t3-focus/list-filter.svg").size(14).text_color(lit("focus-scope", t.dim))))
      .content(v_flex().id("focus-scope-panel").w(260).max_h(360).mt(4).p(6).gap(2).rounded(10)
        .bg(t.popover).border_1().border_color(t.border).text_size(13)
        .child(h_flex().h(32).px(8).gap(8).flex_none().items_center().border_b_1().border_color(t.border)
          .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.dim))
          .child(Input.new(this.search).flex_1().h_full().text_size(13).text_color(t.foreground)))
        .child(v_flex().id("focus-scope-list").min_h(0).pt(4).gap(2).overflow_y_scroll()
          .children(this.matches().map(choice))
          .when(this.matches().length === 0, (el) => el.child(div().px(8).py(6).text_color(t.dim).child("No matching spaces.")))));
    // Right edge as the brand bar's above (pr 10), so the two rows of icons line up.
    const top = h_flex().id("focus-top").h(32).pl(8).pr(10).gap(2).flex_none().items_center()
      .child(h_flex().id("focus-search").flex_1().h(26).px(10).gap(8).items_center().rounded(6)
        .text_color(lit("focus-search", t.dim)).hover((s) => s.bg(t.hover)).on_hover(glow("focus-search"))
        .role("button").accessibility_label("Search").on_click(() => run("mod.open", { name: "picker" }))
        .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(lit("focus-search", t.dim)))
        .child(div().child("Search")))
      .child(filter)
      .child(tool("focus-new-space", "New space", "folder-plus", () => newSpace()))
      // The layout passes its own menu; docked alone, the shipped one.
      .child(tool("focus-new-agent", "New agent", "square-pen", () => run("mod.open", { name: props()?.newMenu ?? "new-menu" })));

    const root = v_flex().id("t3-focus-root").relative().size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_size_change((size) => { this.height = size.height; this.width = size.width; })
      // Esc puts a lifted row back (the sidebar holds the keyboard only while something is lifted).
      .track_focus(this.keys).on_key_down((e, cx) => {
        if (e.keystroke !== "escape") return;
        if (this.drag || this.sweep || this.back) this.endDrag();
        else if (shared("focus.ref")) this.unref(true);
        else if (this.selBack) this.unselect(true);
        else return;
        cx.notify();
      })
      .on_mouse_move((e, cx) => {
        // Where a right-click opens the menu.
        this.pointer = e.local_position ?? this.pointer;
        const g = this.drag ?? this.sweep;
        if (!g || (!g.moved && Math.hypot(e.position.x - g.at.x, e.position.y - g.at.y) <= 6)) return;
        if (!g.moved) { this.back = focused(); this.keys.focus(); }
        g.moved = true;
        g.last = e.local_position ?? g.last;
        if (this.drag) this.drag.y = e.local_position?.y ?? this.drag.y;
        cx.notify();
      })
      // A press elsewhere disarms a reference: a moment later, so a pane header taking it (its press comes after
      // this capture-phase one) gets it first.
      .when(Boolean(shared("focus.ref")), (el) => el
        .on_mouse_down("left", () => this.unref(false))
        .on_mouse_down_out((_e, cx) => cx.timer.after(250, () => this.unref(false))))
      // Released anywhere in the sidebar, it lands where the gap shows.
      .on_mouse_up("left", (_e, cx) => { finish(cx); cx.notify(); })
      // Herdr reports no release outside the sidebar, so leaving decides. Off the top or bottom edge (the Pinned
      // label or the Settled shelf sit there) it lands where the badge says, as T3 keeps the last target past the
      // list's ends; off a side it goes back, or off the right side toward the panes, arms a reference.
      .on_hover((on, cx) => {
        if (on || !(this.drag || this.sweep || this.back)) return;
        const p = (this.drag ?? this.sweep)?.last, w = this.width ?? Infinity, h = this.height ?? Infinity;
        const side = !p || Math.min(p.x, w - p.x) < Math.min(p.y, h - p.y);
        if (side && lifted && w - p.x < p.x) armRef(lifted, cx);
        else if (side) this.endDrag(); else finish(cx);
        cx.notify();
      })
      .child(top)
      .child(v_flex().id("focus-list").flex_1().min_h(0).px(8).py(8).overflow_y_scroll()
        .child(boundary("pinned", "Pinned", "pinned", pinTo(others(pinned)[0]?.address)))
        .child(gap("head-pinned"))
        .children(lane("pinned", pinned, (a) => card(a), 2))
        .child(boundary("active", "Active", "active", { section: "active" }))
        .when(dragging && others(out).length === 0 && !(out.length > 0 && !plan), (el) => el
          .child(plan?.gap === "head-active" ? gap("head-active") : placeholder("active", "Active")))
        .children(lane("active", out, (a) => card(a), 2))
        .when(out.length === 0 && !dragging, (el) => el.child(div().px(10).py(8).text_size(12).text_color(t.dim)
          .child(every.length ? "Nothing needs you." : "No agent status yet. Agents show up here when they report their status.")))
        // While dragging, Settled shows even empty: it's where a drop settles.
        // The free space above the shelves pushes them to the bottom; a drag over it lands in Active, as T3's
        // nearest-row drop does.
        .child(div().id("active-rest").flex_1().min_h(0).on_mouse_move((_e, cx) => aim({ section: "active" }, cx)))
        .child(shelves.when(put.length > 0 || (dragging && !busy(lifted)), (el) => el.child(tail))))
      // The lifted row moves only up and down, inside the list and below the Pinned label (T3's clamps).
      .when(Boolean(lifted) && d.y != null, (el) => el.child(div().id("drag-ghost").absolute().left(8).right(8)
        .top(Math.max(32 + 8 + 24, Math.min(d.y - d.grab, (this.height ?? Infinity) - d.height - 8)))
        .rounded(10).bg(t.selected).border(1).border_color(t.accent).shadow_lg()
        .child(from === "settled" ? slim(lifted, true) : card(lifted, true))))
      // Gone with a click on an item or anywhere else; a right-click elsewhere opens it there instead.
      .when(Boolean(menuItems), (el) => el.child(Popup.new("focus-menu", div().size(0)).absolute()
        .left(this.menu.at?.x ?? 0).top(this.menu.at?.y ?? 0).anchor("top_left")
        .content(v_flex().id("focus-menu-panel").w(220).p(6).gap(2).rounded(10).bg(t.popover).border_1().border_color(t.border)
          .text_size(13).shadow_lg().opacity(this.step("in-focus-menu", cx) ? 1 : 0).transition("opacity", FADE)
          .on_mouse_down_out((e, cx) => {
            if (e.button === "right") return;
            this.menu = null;
            cx.notify();
          })
          .children(menuItems))));
    // What wasn't drawn this time starts from the beginning when it shows again.
    for (const k of Object.keys(this.motion)) if (k.startsWith("in-") && !this.used.has(k)) delete this.motion[k];
    this.used.clear();
    return root;
  }
}
