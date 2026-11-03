const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const node = { items: [], handlers: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "on_click") node.handlers.click = args[0];
      else if (key === "on_mouse_down") node.handlers[args[0]] = args[1];
      else if (key === "on_mouse_up") node.handlers[`up:${args[0]}`] = args[1];
      else if (key === "id") node.key = args[0];
      return proxy;
    };
  } });
  return proxy;
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.key === id) return node;
  for (const child of node.items) { const found = find(child, id); if (found) return found; }
  return null;
}

function texts(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const child of node.items) texts(child, out);
  return out;
}

const calls = [];
const program = { name: "Pi", key: "pi", agent: true };
const pane = { pane: "p2", terminal: "t2", tab: "b", title: "pi", cwd: "/home/me/project", program, status: "working" };
const shell = { pane: "p3", terminal: "t3", tab: "b", title: "me@mac: ~/project", cwd: "/home/me/project", program: { name: "zsh", key: "shell", shell: true }, status: null };
let terms = [{ address: "t2", labels: {} }, { address: "t3", labels: {} }];
let tab = { id: "b", name: "Release", named: true };
let sidebar = { id: "root", children: [{ id: "sidebar-lists", active: "lists" }] };
let props = { pane: "p2" };
const env = {
  View: class {}, div: element, svg: element, image: element, h_flex: element,
  theme: () => ({}), props: () => props, panes: () => [pane, shell], home: () => "/home/me",
  terminals: () => terms, spaces: () => [{ tabs: [tab] }], layout: () => sidebar,
  run: (name, args) => calls.push([name, args]),
  shared: (k) => state[k] ?? null, setShared: (k, v) => { state[k] = v; },
};
const state = {};
const cx = { notify() {}, stop_propagation() {} };
// name.js is inlined as the mod's own copy is.
function load(...files) {
  const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n")
    .replace(/^import .*;\r?\n/gm, "").replace(/export function /g, "function ").replace("export default class", "globalThis.Mod = class");
  const context = vm.createContext({ ...env });
  vm.runInContext(src, context, { filename: files.at(-1) });
  const mod = new context.Mod(); mod.init(); return mod;
}
const take = () => JSON.parse(JSON.stringify(calls.splice(0)));
const header = load(path.join(__dirname, "name.js"), path.join(__dirname, "main.js"));
header.hovered = true;
find(header.render(), "pane-head-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.focus", { pane: "p2" }]]);
find(header.render(), "ph-r-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "right", pane: "p2" }]]);
find(header.render(), "ph-d-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "down", pane: "p2" }]]);
find(header.render(), "ph-z-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.zoom", { pane: "p2" }]]);
find(header.render(), "ph-x-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.close", { pane: "p2" }]]);

// Names: Pi session, else (agents only) a named tab, else a telling title, else the program.
const named = () => texts(header.render())[0];
terms[0].labels["pi.session"] = "Fix login";
assert.equal(named(), "Fix login");
delete terms[0].labels["pi.session"];
assert.equal(named(), "Release");
tab.named = false; pane.title = "π - Review PR";
assert.equal(named(), "π - Review PR");
pane.title = "pi";
assert.equal(named(), "Pi");
tab.named = true; props = { pane: "p3" };
assert.equal(named(), "zsh");

// A settled agent's done dot goes only while the Focus list shows.
props = { pane: "p2" }; pane.status = "done"; header.hovered = false;
const dots = () => header.render().items.length;
const shown = dots();
terms[0].labels.settled = "1:1";
assert.equal(dots(), shown);
sidebar.children[0].active = "focus";
assert.equal(dots(), shown - 1);

// An armed reference: another agent's header takes it, released or pressed on, and t3-focus types it in.
pane.status = "working";
state["focus.ref"] = { address: "t9", title: "Herdr-t3 layout", text: "[agent t9]", at: Date.now() - 20000 };
assert.equal(find(header.render(), "ph-ref-p2"), null, "stale past its 10s (Focus reloaded)");
state["focus.ref"].at = Date.now();
let head = find(header.render(), "pane-head-p2");
assert.ok(texts(head).includes("Drop to reference Herdr-t3 layout"));
head.handlers["up:left"]({}, cx);
assert.equal(state["focus.ref"].to, "p2"); assert.deepEqual(take(), [["t3-focus.reference", null]]);
head.handlers.left({}, cx); assert.deepEqual(take(), [], "taken once");
state["focus.ref"] = null; head.handlers["up:left"]({}, cx);
assert.equal(state["focus.ref"], null, "a stale header's release doesn't re-arm a reference already pasted"); assert.deepEqual(take(), []);
state["focus.ref"] = { address: "t2", title: "Self", text: "[agent t2]", at: Date.now() };
assert.equal(find(find(header.render(), "pane-head-p2"), "ph-ref-p2"), null, "not on its own header");
props = { pane: "p3" }; state["focus.ref"].address = "t9";
assert.equal(find(header.render(), "ph-ref-p3"), null, "not on a shell");
state["focus.ref"] = null;

props = { pane: "missing" };
assert.equal(find(header.render(), "pane-head-p2"), null);
console.log("ok: a lone pane keeps zoom and close; focus, both splits and close target their own pane; names follow the shared rule; a settled done dot hides under Focus; another agent's header takes an armed reference; a missing pane renders nothing.");
