// node --test check-system.cjs (from the installed copy: it loads ../t3-new-menu too)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const strip = (src) => src.replace(/^import .*;\r?\n/gm, "").replace(/^export (const|function|async function) /gm, "$1 ")
  .replace("export default class", "globalThis.Mod = class");

function load(files, env) {
  const context = vm.createContext({ View: class {}, ...env });
  vm.runInContext(files.map((f) => strip(fs.readFileSync(path.join(__dirname, f), "utf8"))).join("\n"), context);
  return context;
}

test("reads top's last sample, macOS free memory and GPU use", () => {
  const { parse } = load(["main.js"], { Date });
  const top = "CPU usage: 3.1% user, 2.0% sys, 94.9% idle\nCPU usage: 40.58% user, 39.5% sys, 20.35% idle\n";
  const mem = "The system has 25769803776 (1572864 pages with a page size of 16384).\nSystem-wide memory free percentage: 33%\n";
  const gpu = '"PerformanceStatistics" = {"Device Utilization %"=23,"In use system memory"=1825914880}';
  assert.equal(JSON.stringify(parse(top, mem, gpu)), JSON.stringify({ cpu: 100 - 20.35, free: 33, gpu: 23 }));
  assert.equal(JSON.stringify(parse(null, "", null)), JSON.stringify({ cpu: null, free: null, gpu: null }));
});

function menu(reading) {
  const f = { runs: [], notes: [] };
  const env = {
    closeOverlay() {}, props: () => ({}), layout: () => null, home: () => "/h",
    shared: (k) => (k === "system.load" ? reading : null),
    notify: (n) => f.notes.push(n), run: (name, args) => f.runs.push([name, args]),
    pickFolder: async () => null, Date,
  };
  const c = loadMenu(env);
  return { f, m: Object.assign(Object.create(c.Mod.prototype), { target: { id: "s1", machine: null } }) };
}
const loadMenu = (env) => load(["../t3-new-menu/space-icon.js", "../t3-new-menu/accounts.js", "../t3-new-menu/main.js"], env);
const claude = { key: "claude", name: "Claude Code", run: ["claude"] };

test("the New menu won't start an agent here while memory is low", () => {
  const { f, m } = menu({ free: 9, low: true, min: 15, at: Date.now() });
  m.start(claude);
  assert.equal(f.runs.length, 0);
  assert.match(f.notes[0].body, /9% of memory is free/);
  m.start(null);
  assert.equal(f.runs[0][0], "tab.new", "a plain terminal still starts");
});

test("it starts agents when memory is fine, the reading is stale, or the agent runs on another machine", () => {
  for (const [load, machine] of [[{ free: 40, low: false, at: Date.now() }, null], [{ free: 9, low: true, at: Date.now() - 60000 }, null],
    [{ free: 9, low: true, at: Date.now() }, "box"], [null, null]]) {
    const { f, m } = menu(load);
    m.target.machine = machine;
    m.start(claude);
    assert.equal(f.runs.at(-1)?.[0], "tab.new");
    assert.equal(f.notes.length, 0);
  }
});
