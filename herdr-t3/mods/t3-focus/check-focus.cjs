const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function element() {
  const node = { key: null, items: [], handlers: {}, style: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (["child", "content", "trigger"].includes(key)) node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "id") node.key = args[0];
      else if (key === "on_mouse_down" || key === "on_mouse_up") node.handlers[`${key}:${args[0]}`] = args[1];
      else if (key.startsWith("on_")) node.handlers[key] = args[0];
      else node.style[key] = args;
      return proxy;
    };
  } });
  return proxy;
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.key === id) return node;
  for (const child of node.items) { const hit = find(child, id); if (hit) return hit; }
  return null;
}

function cards(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.key?.startsWith("card-")) out.push(node.key.slice(5));
  else for (const child of node.items) cards(child, out);
  return out;
}

function texts(node) {
  if (typeof node === "string") return [node];
  return node && typeof node === "object" ? node.items.flatMap(texts) : [];
}

function fixture() {
  const f = { now: 1000, rows: [], terms: [], order: [], calls: [], jobs: [], timers: [], data: new Map(), pins: [], mode: "focus", notifications: [], commands: [], panes: [], gh: [], store: {}, clip: undefined };
  const cx = {
    notify() { f.notified = true; }, stop_propagation() {}, open_url(u) { f.opened = u; },
    read_from_clipboard: () => f.clip, write_to_clipboard(text) { f.clip = text; },
    focus_handle: () => ({ focus() { f.keys = true; } }),
    spawn: (fn) => f.jobs.push(fn),
    timer: {
      every: () => ({}),
      after(ms, fn) {
        const timer = { at: f.now + ms, fn, cancelled: false, cancel() { this.cancelled = true; } };
        f.timers.push(timer);
        return timer;
      },
    },
  };
  const env = {
    View: class {}, div: element, image: element, svg: element, v_flex: element, h_flex: element,
    Popover: { new: element }, Popup: { new: (id, trigger) => element().id(id).child(trigger) }, Input: { new: element }, Button: { new: element },
    InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {} }) },
    CalendarState: { new: () => {
      let v = null;
      const week = [1, 2, 3, 4, 5, 6, 7].map((d) => `2026-11-0${d}`);
      return { today: () => "2026-11-03", year: () => 2026, month: () => 11, value: () => v, set_value: (x) => { v = x; }, month_days: () => [[week]], prev_month() {}, next_month() {} };
    } },
    namer: () => (a) => a.address, Date: class extends Date { static now() { return f.now; } },
    localStorage: { getItem: (k) => f.data.get(k) ?? null, setItem: (k, v) => f.data.set(k, v) },
    agents: () => f.rows, terminals: () => f.terms, panes: () => f.panes,
    exec: (cmd, args, opts) => new Promise((ok, no) => f.gh.push({ cmd, args, opts, ok, no })),
    spaces: () => [{ id: "s1", name: "One", tabs: [] }, { id: "s2", name: "Two", tabs: [] }],
    focused: () => ({ agent: f.rows.find((a) => a.focused)?.address }),
    theme: () => ({}), settings: () => ({}), props: () => ({}),
    layout: () => ({ id: "sidebar-lists", active: f.mode }),
    shared: (k) => k === "agents.pins" ? f.pins : f.store[k] ?? null,
    setShared: (k, v) => { if (k === "agents.pins") f.pins = Array.from(v); else f.store[k] = v; },
    home: () => "/Users/me",
    setAgentOrder: (xs) => { f.order = Array.from(xs); },
    run: (...args) => f.calls.push(args), notify: (n) => f.notifications.push(n), openOverlay() {}, closeOverlay() {},
    hc: async () => ({ code: 0 }), pickFolder: async () => f.picked, nextCommand: () => f.commands.length ? Promise.resolve(f.commands.shift()) : new Promise(() => {}),
  };
  // space-icon.js, the shared avatar rule, is inlined as the mod's own copy is.
  const src = ["space-icon.js", "main.js"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export (const|function|async function) /gm, "$1 ").replace("export default class", "globalThis.Mod = class");
  const context = vm.createContext(env);
  vm.runInContext(src, context, { filename: "t3-focus/main.js" });
  f.mod = new context.Mod(); f.mod.init({}, cx);
  f.loadAgents = () => {
    const src = fs.readFileSync(path.join(__dirname, "../t3-agents/main.js"), "utf8")
      .replace(/^import .*;\r?\n/gm, "").replace("export default class", "globalThis.Mod = class");
    const context = vm.createContext({ ...env });
    vm.runInContext(src, context);
    const mod = new context.Mod(); mod.init({});
    return () => mod.render(cx);
  };
  f.add = (address, status = "idle", ms = 100) => {
    const row = { address, status, seq: f.rows.length + 1, space: "s1", space_name: "One", pane: address, program: {}, focused: false };
    f.rows.push(row);
    f.terms.push({ address, status, status_ms: ms, state: "live", turn: 0, labels: {} });
    return row;
  };
  f.render = (now = f.now) => {
    f.now = now;
    for (const timer of f.timers) if (!timer.cancelled && timer.at <= now) { timer.cancel(); timer.fn(cx); }
    f.tree = f.mod.render(cx);
    return f.tree;
  };
  f.working = () => cards(find(f.tree, "shelves"));
  f.active = () => cards(find(f.tree, "focus-list")).filter((a) => !f.working().includes(a) && !f.pins.includes(a));
  f.event = (id, name, e = {}) => {
    const node = find(f.tree, id);
    assert.ok(node, `missing ${id}`);
    assert.ok(node.handlers[name], `missing ${name} on ${id}`);
    node.handlers[name]({ position: { x: 20, y: 100 }, local_position: { x: 20, y: 100 }, bounds: { height: 82 }, modifiers: {}, ...e }, cx);
  };
  f.settle = () => f.mod.settleKey(cx);
  f.cx = cx;
  f.env = env;
  return f;
}

test("a quick continuation keeps its Working place, showing its real state meanwhile", () => {
  const f = fixture(), a = f.add("A", "working", 100); f.add("B", "working", 200); f.mod.workOpen = true;
  f.render(); assert.deepEqual(f.working(), ["B", "A"]);
  a.status = "done"; f.render(1100);
  assert.deepEqual(f.working(), ["B", "A"]);
  assert.ok(texts(find(f.tree, "state-A")).includes("Done"));
  a.status = "working"; f.render(1300);
  assert.deepEqual(f.working(), ["B", "A"]);
});

test("a finished run moves to Active once the grace is out; blocked moves at once", () => {
  const f = fixture(), a = f.add("A", "working"), b = f.add("B", "working"); f.mod.workOpen = true;
  f.render(); a.status = "idle"; f.render(1100);
  f.terms[0].turn++; f.render(2000); // the turn's end arriving late doesn't restart the grace
  f.render(3099); assert.deepEqual(f.working(), ["A", "B"]);
  assert.ok(f.timers.some((t) => !t.cancelled && t.at === 3100)); // on time, not on the next second's tick
  f.render(3100); assert.deepEqual(f.active(), ["A"]);
  b.status = "blocked"; f.render(3200); assert.deepEqual(f.active(), ["B", "A"]);
  f.terms.push({ address: "kid", parent: "A", state: "live", status: "error" });
  a.status = "working"; f.render(3300); assert.deepEqual(f.active(), ["A", "B"]);
});

test("looking, seq and data order don't reshuffle; equal times go by address", () => {
  const f = fixture(), a = f.add("B", "done"); f.add("A", "done");
  f.render(); assert.deepEqual(f.order, ["A", "B"]);
  a.status = "idle"; a.focused = true; a.seq = 99; f.rows.reverse(); f.render(1500);
  assert.deepEqual(f.order, ["A", "B"]);
  for (const k of f.terms) k.labels.settled = "500:0";
  f.render(1600); f.rows.reverse(); f.render(1700); assert.deepEqual(f.order, ["A", "B"]);
});

test("a short absence and a restart keep each agent's place", () => {
  const f = fixture(), a = f.add("A", "working"), b = f.add("B"), c = f.add("C", "idle", 1500);
  f.render(1600); a.status = "done"; f.render(2000); f.render(4100);
  assert.deepEqual(f.order, ["A", "C", "B"]);
  f.rows = [b, c]; b.status = "working"; f.render(4200);
  f.rows = [a, b, c]; f.render(4300); assert.deepEqual(f.order, ["A", "C", "B"]);
  const g = fixture(); g.data = f.data; g.rows = f.rows; g.terms = f.terms; g.mod.init({}, g.cx);
  g.render(4400); assert.deepEqual(g.order, f.order);
  f.terms[0].state = "exited"; f.rows = [b, c]; c.status = "working"; f.render(4500);
  assert.equal(f.mod.changed.A, undefined);
});

test("a turn that ended unseen is news; unsettling doesn't land on Working", () => {
  const f = fixture(), a = f.add("A", "idle", 200); f.add("B", "idle", 100);
  f.render(); assert.deepEqual(f.order, ["A", "B"]);
  f.terms[1].turn++; f.render(1500); assert.deepEqual(f.order, ["B", "A"]);
  f.terms[0].labels.settled = "1000:0"; f.render(1600);
  a.focused = true; f.settle(); f.render(1700);
  assert.deepEqual(f.working(), []); assert.deepEqual(f.order, ["A", "B"]);
});

// Without t3-agents beside it, there's no agents list to load.
const lists = fs.existsSync(path.join(__dirname, "../t3-agents/main.js"));
test("only the sidebar list in view sets agent.next order", { skip: !lists && "t3-agents isn't here" }, () => {
  const f = fixture(); f.add("A", "working"); f.add("B", "idle", 200); f.render();
  const order = [...f.order], renderAgents = f.loadAgents(); renderAgents();
  assert.deepEqual(f.order, order);
  f.mode = "lists"; renderAgents(); const lists = [...f.order];
  f.render(1500); assert.deepEqual(f.order, lists);
});

test("a pause for the person keeps the run's Working place", () => {
  const f = fixture(), a = f.add("A", "working", 100); f.add("B", "working", 200); f.mod.workOpen = true;
  f.render(); a.status = "blocked"; f.render(1100); assert.deepEqual(f.active(), ["A"]);
  a.status = "working"; f.render(9000); assert.deepEqual(f.working(), ["B", "A"]);
});

test("a run out of its grace lands on top of Active, over one that came back meanwhile", () => {
  const f = fixture(), a = f.add("A", "working"), b = f.add("B", "working"); f.mod.workOpen = true;
  f.render(); a.status = "idle"; f.render(1100);
  b.status = "blocked"; f.render(2000); assert.deepEqual(f.active(), ["B"]);
  f.render(3100); assert.deepEqual(f.active(), ["A", "B"]);
});

test("pinned agents skip the grace: unpinned right after stopping, it's in Active", () => {
  const f = fixture(), a = f.add("A", "working"); f.pins = ["A"]; f.mod.workOpen = true;
  f.render(); a.status = "idle"; f.render(1100);
  f.pins = []; f.render(1200);
  assert.deepEqual(f.active(), ["A"]); assert.deepEqual(f.working(), []);
});

test("Settle in view moves down the cards, then from the top", () => {
  const go = (focus) => {
    const f = fixture(); f.add("A", "idle", 300); f.add("B", "idle", 200); f.add("P", "idle", 100); f.pins = ["P"];
    f.rows.find((a) => a.address === focus).focused = true; f.render(); assert.deepEqual(f.order, ["P", "A", "B"]);
    f.settle(); return f.calls.at(-1)[1].terminal;
  };
  assert.equal(go("A"), "B");
  assert.equal(go("B"), "P");
});

test("times read as T3's", () => {
  const f = fixture(), a = f.add("A", "working"), b = f.add("B", "working"); f.mod.workOpen = true;
  f.render(); f.render(1000 + 3720000);
  assert.ok(texts(find(f.tree, "card-A")).includes("1h 2m"));
  b.status = "idle"; f.render(4000000); f.render(4002000);
  assert.ok(texts(find(f.tree, "state-B")).includes("just now"));
  f.render(4002000 + 9 * 86400000); assert.ok(texts(find(f.tree, "state-B")).includes("9d"));
});

test("a new scope starts the settled tail over", () => {
  const f = fixture(); f.mod.limit = 35; f.mod.pick({ id: "s1" }, false, f.cx);
  assert.equal(f.mod.limit, 10);
});

test("a plain click on Settle leaves no sweep behind to swallow the next click", () => {
  const f = fixture(), a = f.add("A", "idle", 100); f.add("B", "idle", 50); f.add("C", "idle", 30); a.focused = true;
  f.render(); f.mod.hovered = "A"; f.render();
  f.event("settle-A", "on_mouse_down:left");
  // The button's click stops its release there: the sidebar's own mouse-up never comes.
  f.event("settle-A", "on_click"); f.render(1100);
  f.event("t3-focus-root", "on_mouse_move", { position: { x: 20, y: 300 } });
  assert.equal(f.keys, undefined, "the sidebar doesn't take the keyboard");
  f.event("card-C", "on_click");
  assert.deepEqual([f.calls.at(-1)[0], f.calls.at(-1)[1].terminal], ["agent.focus", "C"], "the next click opens the card at once");
});

test("a plain click on a settled row's undo leaves no sweep behind either", () => {
  const f = fixture(); f.add("A"); f.terms[0].labels.settled = "500:0"; f.mod.open = true;
  f.render(); f.mod.hovered = "A"; f.render();
  f.event("unsettle-A", "on_mouse_down:left"); f.event("unsettle-A", "on_click"); f.render(1100);
  f.event("t3-focus-root", "on_mouse_move", { position: { x: 20, y: 300 } });
  assert.equal(f.keys, undefined); assert.equal(f.mod.sweep, null);
});

test("snoozing folds the card out of Active as its shelf row grows in; waking reverses it", () => {
  const f = fixture(); f.add("A", "done", 100); f.add("B", "done", 200); f.mod.dozeOpen = true;
  const h = (id) => find(f.tree, id)?.style.h?.[0];
  f.render(1020);
  f.mod.snoozeTo("A", 5000, f.cx);
  f.terms[0].labels.snoozed = "5000:1020";
  f.render(1030); // the start frame: the card still full, the row still shut
  assert.equal(h("hold-A"), 84); assert.equal(h("zlane-A"), 0);
  f.render(1050); // moving
  assert.equal(h("hold-A"), 0); assert.equal(h("zlane-A"), 30);
  f.render(1300); // over: the card is gone from Active
  assert.equal(find(f.tree, "hold-A"), null); assert.equal(h("zlane-A"), 30);
  f.render(5000); // due: the row starts folding away, the card starts unfolding at the top
  f.terms[0].labels.snoozed = "";
  assert.equal(h("zlane-A"), 30); assert.equal(h("hold-A"), 0);
  f.render(5050);
  assert.equal(h("zlane-A"), 0); assert.equal(h("hold-A"), 84);
  f.render(5400); // over: no row, and the card's height is its own again
  assert.equal(find(f.tree, "zlane-A"), null); assert.equal(h("hold-A"), undefined);
  assert.deepEqual(f.active(), ["A", "B"]);
  assert.equal(f.notifications.length, 1);
});

test("cmd-1..9 jump to the cards as they read: pinned, Active, then the Working shown; the hint shows on hover", async () => {
  const f = fixture(); f.add("A", "idle", 300); f.add("B", "idle", 200); f.add("P", "idle", 100); f.add("W", "working"); f.pins = ["P"];
  f.render(); f.mod.hovered = "B"; f.render();
  assert.ok(texts(find(f.tree, "jump-B")).includes("⌘3")); assert.equal(find(f.tree, "jump-A"), null);
  f.commands.push("jump-1", "jump-3", "jump-4", "jump-9"); f.jobs[0](f.cx); await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.calls.map((c) => c[1].terminal), ["P", "B"]); // W's shelf is folded; nothing is 9th
  f.mod.workOpen = true; f.render(); f.mod.jump(4);
  assert.equal(f.calls.at(-1)[1].terminal, "W");
});

test("Mark unread brings a settled agent back to Active as Done until it's next looked at", () => {
  const f = fixture(), a = f.add("A", "idle", 100), b = f.add("B", "idle", 200); f.terms[0].labels.settled = "500:0"; f.mod.open = true;
  f.render(); assert.deepEqual(f.active(), ["B"]);
  f.event("slim-A", "on_mouse_down:right"); f.render(1100);
  f.event("menu-unread", "on_click"); f.render(1200);
  assert.equal(f.mod.menu, null); assert.deepEqual(f.active(), ["A", "B"]);
  assert.ok(texts(find(f.tree, "state-A")).includes("Done"));
  Object.assign(f.terms[0].labels, { settled: "", unread: f.mod.marking.A }); f.render(1300);
  assert.equal(f.mod.marking.A, undefined, "the core has it");
  a.focused = true; f.render(1400); assert.equal(f.mod.marking.A, "", "looked at, it's read");
  // Marked while in view, it waits for the next look.
  f.terms[0].labels.unread = ""; f.render(1500);
  f.event("card-A", "on_mouse_down:right"); f.render(1600); f.event("menu-unread", "on_click"); f.render(1700);
  assert.ok(f.mod.marking.A); f.render(1800); assert.ok(f.mod.marking.A);
  a.focused = false; b.focused = true; f.render(1900); b.focused = false; a.focused = true; f.render(2000);
  assert.equal(f.mod.marking.A, "");
});

test("cmd-click and shift-click select cards; Settle, Snooze and Esc act on the selection; a plain click ends it", () => {
  const f = fixture(); f.env.theme = () => ({ accent: "#abc" });
  f.add("A", "idle", 500); f.add("B", "idle", 400); f.add("C", "idle", 300); f.add("D", "idle", 200); f.add("E", "idle", 100);
  f.render(); assert.deepEqual(f.active(), ["A", "B", "C", "D", "E"]);
  f.event("card-B", "on_click", { modifiers: { platform: true } }); f.event("card-D", "on_click", { modifiers: { shift: true } }); f.render(1100);
  assert.deepEqual([...f.mod.selected], ["B", "C", "D"]); assert.equal(f.calls.length, 0); assert.equal(f.keys, true, "Esc can reach it");
  assert.equal(find(f.tree, "card-C").style.bg[0], "#abc26");
  f.event("card-C", "on_click", { modifiers: { platform: true } }); assert.deepEqual([...f.mod.selected], ["B", "D"]);
  f.mod.hovered = "D"; f.render(1200); f.event("settle-D", "on_click"); f.render(1300);
  assert.deepEqual(f.active(), ["A", "C", "E"]); assert.equal(f.mod.selected.size, 0);
  f.event("card-A", "on_click", { modifiers: { platform: true } }); f.event("card-E", "on_click", { modifiers: { platform: true } }); f.render(1400);
  f.event("card-A", "on_mouse_down:right"); f.render(1500);
  assert.ok(texts(find(f.tree, "menu-unread")).includes("Mark unread (2)"));
  f.mod.menu = null; f.mod.snoozeTo("E", 9000, f.cx); f.render(1600);
  assert.deepEqual(Object.keys(f.mod.snoozing).sort(), ["A", "E"]); assert.equal(f.mod.selected.size, 0);
  f.event("card-C", "on_click", { modifiers: { platform: true } }); f.render(1700);
  f.event("t3-focus-root", "on_key_down", { keystroke: "escape" }); assert.equal(f.mod.selected.size, 0);
  f.event("card-C", "on_click", { modifiers: { platform: true } }); f.event("card-C", "on_click");
  assert.equal(f.mod.selected.size, 0); assert.deepEqual([f.calls.at(-1)[0], f.calls.at(-1)[1].terminal], ["agent.focus", "C"]);
});

test("a custom snooze: typed days, weeks and dates, and a picked day and time still ahead", () => {
  const f = fixture(), now = new Date(2026, 10, 3, 10, 30).getTime(); // Tuesday
  const at = (s) => { const ms = f.env.parseWake(s, now); return ms && new Date(ms).toString().slice(0, 21); };
  assert.equal(at("in 3 days"), "Fri Nov 06 2026 10:30");
  assert.equal(at("fri"), "Fri Nov 06 2026 09:00");
  assert.equal(at("Friday 10:00"), "Fri Nov 06 2026 10:00");
  assert.equal(at("mon 9"), "Mon Nov 09 2026 09:00");
  assert.equal(at("tue"), "Tue Nov 10 2026 09:00", "today's 9:00 is past: next week");
  assert.equal(at("nov 12"), "Thu Nov 12 2026 09:00");
  assert.equal(at("nov 2 14:00"), "Tue Nov 02 2027 14:00", "past this year: next year");
  assert.equal(at("2026-11-12 9:00"), "Thu Nov 12 2026 09:00");
  for (const s of ["2026-11-01", "feb 30", "monkey", "nov 12 25", "0m"]) assert.equal(at(s), null, s);
  assert.equal(at("12/11 14:00"), f.env.DAY_FIRST === null ? null : f.env.DAY_FIRST ? "Thu Nov 12 2026 14:00" : "Fri Dec 11 2026 14:00");
  assert.equal(f.env.wakes(new Date(2026, 10, 9, 9).getTime(), now), "Mon 9:00");
  assert.equal(f.env.wakes(new Date(2026, 10, 10, 9).getTime(), now), "Nov 10 9:00");
  f.add("A", "done"); f.render(now); f.mod.snoozeFor = "A"; f.mod.picking = true; f.render(now + 10);
  assert.equal(find(f.tree, "pick-A-2026-11-02").handlers.on_click, undefined, "past days are off");
  assert.equal(find(f.tree, "pick-A-go").handlers.on_click, undefined, "no day yet");
  f.event("pick-A-2026-11-03", "on_click"); f.render(now + 20);
  assert.equal(find(f.tree, "pick-A-go").handlers.on_click, undefined, "today at 9:00 is past");
  f.event("pick-A-2026-11-05", "on_click"); f.render(now + 30); f.event("pick-A-go", "on_click");
  assert.equal(f.mod.snoozing.A, `${new Date(2026, 10, 5, 9).getTime()}:${now + 30}`);
  // From the right-click menu, for a whole selection.
  const g = fixture(); g.add("B", "done", 300); g.add("C", "done", 200); g.render(now);
  g.event("card-B", "on_click", { modifiers: { platform: true } }); g.event("card-C", "on_click", { modifiers: { platform: true } });
  g.event("card-B", "on_mouse_down:right"); g.render(now + 10); g.event("menu-pick", "on_click"); g.render(now + 20);
  assert.equal(find(g.tree, "menu-unread"), null, "the picker takes the menu's place");
  g.event("pick-B-2026-11-06", "on_click"); g.render(now + 30); g.event("pick-B-go", "on_click");
  assert.deepEqual(Object.keys(g.mod.snoozing).sort(), ["B", "C"]); assert.equal(g.mod.menu, null); assert.equal(g.mod.selected.size, 0);
});

test("PR badges: gh off render, two at a time, cached three minutes; no PR or no gh shows nothing", async () => {
  const f = fixture(), now = 5000;
  for (const [a, branch] of [["A", "feat"], ["B", "feat"], ["C", "x"], ["D", "y"]]) { f.add(a, "idle", 100); f.panes.push({ pane: a, cwd: "/r", branch }); }
  const jobs = () => f.jobs.splice(1).map((j) => j(f.cx)), tick = () => new Promise((r) => setImmediate(r));
  f.render(now); assert.equal(f.gh.length, 0, "never from render");
  f.render(now + 1); const run1 = jobs();
  assert.deepEqual(f.gh.map((g) => g.args[2]), ["feat", "x"], "one run per branch, two at a time");
  assert.equal(f.gh[0].args.join(" "), "pr view feat --json number,state,isDraft,statusCheckRollup,url"); assert.equal(f.gh[0].opts.cwd, "/r");
  f.gh[0].ok({ code: 0, stdout: JSON.stringify({ number: 12, state: "OPEN", isDraft: false, url: "https://github.com/o/r/pull/12",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "FAILURE" }] }) });
  f.gh[1].ok({ code: 1, stdout: "", stderr: "no pull requests found" });
  await Promise.all(run1); const run2 = jobs(); await tick();
  assert.equal(f.gh.length, 3, "the third starts as one ends"); f.gh[2].no(new Error("gh: not found")); await Promise.all(run2);
  f.render(now + 2);
  for (const a of ["A", "B"]) assert.ok(texts(find(f.tree, `pr-${a}`)).includes("#12"));
  assert.equal(find(f.tree, "pr-A").style.accessibility_label[0], "Pull request #12, open, checks failing");
  for (const a of ["C", "D"]) assert.equal(find(f.tree, `pr-${a}`), null);
  f.event("pr-A", "on_click"); assert.equal(f.opened, "https://github.com/o/r/pull/12"); assert.equal(f.calls.length, 0, "the card doesn't open");
  assert.equal(f.notifications.length, 0);
  f.render(now + 179000); jobs(); assert.equal(f.gh.length, 3, "cached");
  f.panes[0].branch = "feat2"; f.render(now + 179001); f.render(now + 179002); jobs();
  assert.equal(f.gh.at(-1).args[2], "feat2", "a new branch is asked at once");
  f.render(now + 181000); f.render(now + 181001); jobs(); assert.ok(f.gh.length > 4, "asked again after 3 minutes");
});

test("a card dragged out the right edge arms a reference; Esc, 10s or a press elsewhere disarm it; a drop pastes it", async () => {
  const f = fixture(); f.add("A", "idle", 200); f.add("B", "idle", 100); f.panes.push({ pane: "A", cwd: "/Users/me/r" }, { pane: "pB" });
  const text = '[agent A "A" · ~/r · read it with: hc read A]', root = () => find(f.tree, "t3-focus-root");
  const lift = (now) => {
    f.render(now); f.event("t3-focus-root", "on_size_change", { width: 300, height: 800 });
    f.event("card-A", "on_mouse_down:left"); f.event("t3-focus-root", "on_mouse_move", { position: { x: 295, y: 120 }, local_position: { x: 295, y: 120 } });
    f.render(now + 1); root().handlers.on_hover(false, f.cx);
  };
  lift(1000);
  assert.equal(f.store["focus.ref"].text, text); assert.equal(f.store["focus.ref"].address, "A");
  assert.equal(f.mod.drag, null); assert.equal(f.keys, true, "the sidebar keeps the keyboard for Esc");
  f.render(1100); f.event("t3-focus-root", "on_key_down", { keystroke: "escape" }); assert.equal(f.store["focus.ref"], null);
  // Out the left edge it goes back, as before.
  f.render(1200); f.event("card-A", "on_mouse_down:left"); f.event("t3-focus-root", "on_mouse_move", { position: { x: 5, y: 120 }, local_position: { x: 5, y: 120 } });
  f.render(1201); root().handlers.on_hover(false, f.cx); assert.equal(f.store["focus.ref"], null);
  lift(2000); f.render(11999); assert.ok(f.store["focus.ref"]); f.render(12001); assert.equal(f.store["focus.ref"], null, "10s");
  lift(13000); f.render(13100); root().handlers.on_mouse_down_out({}, f.cx); f.render(13360); assert.equal(f.store["focus.ref"], null, "a press elsewhere");
  // Dropped on B's header (t3-pane sets `to` and sends the command): focused, pasted, the old clipboard back.
  lift(14000); f.clip = "old"; f.calls.length = 0; f.store["focus.ref"].to = "pB"; f.commands.push("reference");
  f.jobs[0](f.cx); await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.calls.map((c) => c[0]), ["pane.focus", "terminal.paste"]); assert.equal(f.calls[0][1].pane, "pB");
  assert.equal(f.clip, text); assert.equal(f.store["focus.ref"], null);
  f.render(14600); assert.equal(f.clip, "old");
  // A drop on a pane that closed meanwhile pastes nowhere.
  lift(14700); f.calls.length = 0; f.store["focus.ref"].to = "gone"; f.commands.push("reference"); f.jobs[0](f.cx);
  await new Promise((r) => setImmediate(r)); assert.deepEqual(f.calls, []); assert.equal(f.store["focus.ref"], null);
  // The menu's: into the agent in view, no drag.
  f.env.focused = () => ({ pane: "pB", terminal: "B" }); f.calls.length = 0;
  f.render(15000); f.event("card-A", "on_mouse_down:right"); f.render(15001); f.event("menu-reference", "on_click");
  assert.deepEqual(f.calls.map((c) => c[0]), ["pane.focus", "terminal.paste"]); assert.equal(f.clip, text);
  f.event("card-B", "on_mouse_down:right"); f.render(15002); assert.equal(find(f.tree, "menu-reference"), null, "not into itself");
});

test("a reference stays one harmless line whatever the title holds", () => {
  const f = fixture();
  assert.equal(f.env.oneLine('[agent t1 "a\nrm -rf ~\r\u001b[201~x\u202e"]'), '[agent t1 "a rm -rf ~ [201~x "]');
});

test("New space asks for a folder: it starts there, and cancelling makes nothing", async () => {
  const f = fixture(); f.render();
  f.picked = null; f.event("focus-new-space", "on_click"); await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.calls.filter((c) => c[0] === "space.new"), []);
  f.picked = "/Users/me/acme"; f.event("focus-new-space", "on_click"); await new Promise((r) => setImmediate(r));
  assert.equal(JSON.stringify(f.calls.filter((c) => c[0] === "space.new")), JSON.stringify([["space.new", { folder: "/Users/me/acme" }]]));
});
