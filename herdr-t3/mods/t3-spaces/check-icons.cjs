// Space icons: favicon lookup order, which picture a space shows, pruning with spaces, and the
// space-icon.js copies staying one file. Run: node check-icons.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mods = path.dirname(__dirname);
const read = (mod, file) => fs.readFileSync(path.join(mods, mod, file), "utf8");

function element(kind, source) {
  const node = { kind, source, key: null, items: [], style: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "id") node.key = args[0];
      else node.style[key] = args[0];
      return proxy;
    };
  } });
  return proxy;
}
const walk = (n) => (n && typeof n === "object" ? [n, ...n.items.flatMap(walk)] : []);

// Loads files as one script, imports gone, as the mods' own copies are inlined.
function load(files, extra = {}) {
  const state = {}, spaces = [], ps = [];
  const env = {
    div: () => element("div"), h_flex: () => element("h"), v_flex: () => element("v"),
    image: (s) => element("image", s), svg: (s) => element("svg", s), View: class {},
    shared: (k) => state[k], setShared: (k, v) => { state[k] = v; },
    theme: () => new Proxy({}, { get: () => "#777777" }), spaces: () => spaces, panes: () => ps,
    agents: () => [], machines: () => [], window: () => ({ active: false }), layout: () => ({}),
    localStorage: { getItem: () => null, setItem() {} }, appHome: () => "/app", exec: async () => ({ code: 1 }),
    ...extra,
  };
  const source = files.map(([mod, file]) => read(mod, file)).join("\n")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export (const|function|async function) /gm, "$1 ")
    .replace("export default class", "globalThis.Mod = class")
    + "\nglobalThis.api = { findFavicon, iconHref, spaceIcon, avatar };";
  const context = vm.createContext(env);
  vm.runInContext(source, context);
  return { ...context.api, Mod: context.Mod, state, spaces, ps };
}

// One file in every mod that draws avatars (t3-focus too, once it takes it).
const copies = ["t3-new-menu", "t3-menu", "t3-focus"].filter((m) => fs.existsSync(path.join(mods, m, "space-icon.js")));
for (const m of copies) assert.equal(read(m, "space-icon.js"), read("t3-spaces", "space-icon.js"), `${m}/space-icon.js is t3-spaces' copy`);

(async () => {
  const { findFavicon, iconHref, spaceIcon, avatar, state } = load([["t3-spaces", "space-icon.js"]]);
  const tree = (files, pages = {}) => [async (p) => files.includes(p), async (p) => pages[p] ?? null];

  // T3 Code's order: well-known files first, src/app/favicon.ico before src/app/icon.svg.
  assert.equal(await findFavicon("/r", ...tree(["/r/src/app/icon.svg", "/r/src/app/favicon.ico"])), "/r/src/app/favicon.ico");
  assert.equal(await findFavicon("/r", ...tree(["/r/public/favicon.svg", "/r/favicon.ico"])), "/r/favicon.ico");
  // Then the icon index.html links, public/ first.
  const page = '<head><link href="/x.css" rel="stylesheet"><link rel="icon" type="image/png" href="/logo.png?v=2"></head>';
  assert.equal(await findFavicon("/r", ...tree(["/r/public/logo.png", "/r/logo.png"], { "/r/index.html": page })), "/r/public/logo.png");
  assert.equal(await findFavicon("/r", ...tree(["/r/logo.png"], { "/r/index.html": page })), "/r/logo.png");
  // Nothing outside the project, no URLs, nothing found: null.
  for (const href of ["https://cdn.example/f.ico", "//cdn.example/f.ico", "../../secret.png"])
    assert.equal(await findFavicon("/r", ...tree(["/r/f.ico", "/secret.png"], { "/r/index.html": `<link rel="icon" href="${href}">` })), null, href);
  assert.equal(await findFavicon("/r", ...tree([])), null);
  assert.equal(iconHref('links: [{ rel: "icon", href: "/favicon.svg" }]'), "/favicon.svg", "a route's head() links count");

  // Which picture: the pick, else the favicon; "none" is the letter even with a favicon.
  state["space.favicons"] = { a: "data/space-icons/f.png", b: "data/space-icons/g.png", c: "data/space-icons/h.png" };
  state["space.icons"] = { a: { kind: "none" }, b: { kind: "file", path: "icons/go.svg" }, c: { kind: "auto" } };
  assert.deepEqual(["a", "b", "c", "d"].map(spaceIcon), [null, "icons/go.svg", "data/space-icons/h.png", null]);
  const a = walk(avatar("a", "alpha", 18)), b = walk(avatar("b", "beta", 18)), c = walk(avatar("c", "gamma", 18));
  assert.ok(a.some((n) => n.items.includes("A")) && !a.some((n) => n.kind === "image"), "none: the letter tile");
  assert.ok(b.find((n) => n.kind === "svg")?.source === "icons/go.svg" && b[0].style.bg, "a Herdr icon: a glyph on the space's color");
  assert.equal(c.find((n) => n.kind === "image")?.source, "data/space-icons/h.png", "automatic: the favicon");
  assert.deepEqual([c[0].style.size, c[0].style.rounded], [18, 5], "same size and corners as the tile");

  // t3-spaces prunes picks of spaces that are gone, as it does their colors, and publishes favicons per space.
  const exists = new Set(["/work/site/public/favicon.ico"]), made = [];
  const sp = load([["t3-spaces", "space-icon.js"], ["t3-spaces", "main.js"]], {
    fs: { exists: async (p) => exists.has(p) || made.includes(p), mkdir: async () => {} },
    readTextFile: async () => null, appHome: () => "/app",
    exec: async (cmd, args) => { if (cmd === "sips") made.push(args[args.length - 1]); return { code: cmd === "sips" ? 0 : 1, stdout: "", stderr: "not a git repository" }; },
  });
  sp.spaces.push({ id: "s1", name: "site", folder: "/work/site", machine: null, tabs: [] }, { id: "s2", name: "far", folder: "/srv", machine: "vps", tabs: [] });
  sp.state["space.icons"] = { s1: { kind: "auto" }, gone: { kind: "none" } };
  sp.state["space.favicons"] = { gone: "data/space-icons/old.png" };
  const jobs = [], cx = { notify() {}, spawn: (fn) => jobs.push(fn(cx)), timer: { every() {} }, focus_handle: () => ({ focus() {} }) };
  const mod = new sp.Mod();
  mod.init({}, cx);
  mod.render(cx);
  assert.deepEqual(Object.keys(sp.state["space.icons"]), ["s1"], "a gone space's icon goes");
  // git answers (not a repo), then the folder is looked at once; the remote space never is.
  mod.checkNew(cx);
  while (jobs.length) await jobs.shift();
  mod.checkNew(cx);
  while (jobs.length) await jobs.shift();
  mod.checkNew(cx);
  const icon = sp.state["space.favicons"].s1;
  assert.match(icon, /^data\/space-icons\/[0-9a-f]+\.png$/, "the favicon, converted under data/");
  assert.deepEqual(Object.keys(sp.state["space.favicons"]), ["s1"], "favicons only for spaces there are, local ones");
  assert.equal(made.length, 1, "converted once");

  // t3-menu: the space menu offers Icon…, which opens the dialog; each choice there is stored at once.
  const menuProps = { tab: "space", target: { id: "s1" }, overlay: "o1" }, overlays = [];
  const mm = load([["t3-menu", "space-icon.js"], ["t3-menu", "main.js"]], {
    props: () => menuProps, openOverlay: (o) => overlays.push(o), closeOverlay() {}, run() {}, keys: () => [], terminals: () => [],
    home: () => "/home/me", InputState: { new: () => ({ on() {}, value: () => "" }) }, Input: { new: () => element("input") },
    fs: { readdir: async () => ["go.svg", "notes.txt"], exists: async () => false, mkdir: async () => {} },
  });
  mm.spaces.push({ id: "s1", name: "site", folder: "", machine: null, tabs: [] });
  const menu = new mm.Mod();
  menu.init({}, cx);
  assert.ok(JSON.stringify(walk(menu.render(cx)).flatMap((n) => n.items)).includes("Icon…"), "the space menu lists Icon…");
  menu.choose(1, cx); // Rename, Icon…, Close: no worktree items outside a repo
  assert.deepEqual(JSON.parse(JSON.stringify(overlays.pop()?.props ?? null)), { tab: "space-icon", target: { id: "s1" } }, "Icon… opens the dialog for that space");
  Object.assign(menuProps, { tab: "space-icon" });
  const dialog = new mm.Mod();
  dialog.init({}, cx);
  while (jobs.length) await jobs.shift();
  const d = walk(dialog.render(cx));
  assert.deepEqual(d.filter((n) => n.key?.startsWith("glyph-")).map((n) => n.key), ["glyph-go.svg"], "Herdr's svg icons, nothing else");
  for (const [key, value] of [["icon-none", { kind: "none" }], ["glyph-go.svg", { kind: "file", path: "icons/go.svg" }], ["icon-auto", { kind: "auto" }]]) {
    d.find((n) => n.key === key).style.on_click();
    assert.deepEqual(JSON.parse(JSON.stringify(mm.state["space.icons"].s1)), value, key);
  }

  console.log(`ok: favicon order and links, picks over favicons, avatar kinds, pruning, ${copies.length} identical copies`);
})().catch((e) => { console.error(e); process.exit(1); });
