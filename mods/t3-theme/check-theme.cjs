// node --test mods/t3-theme/check-theme.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "theme-file.js"), "utf8").replace(/^export /gm, "");
const lib = vm.createContext({});
vm.runInContext(`${src}\nglobalThis.lib = { GROUPS, KEYS, validHex, normHex, slugify, invalidKeys, themeJson, fromThemeJson };`, lib);
const { KEYS, validHex, normHex, slugify, invalidKeys, themeJson, fromThemeJson } = lib.lib;

const full = () => Object.fromEntries(KEYS.map((k, i) => [k, `#${(0x101010 + i).toString(16)}`]));

test("hex validation takes #rgb, #rrggbb and #rrggbbaa only", () => {
  for (const ok of ["#abc", "#ABCDEF", "#a1b2c3d4", " #123456 "]) assert.ok(validHex(ok), ok);
  for (const bad of ["", "abc", "#ab", "#abcd", "#abcde", "#abcdefg", "#abcdef1", "#ggg", "red", null, undefined]) assert.ok(!validHex(bad), String(bad));
  assert.equal(normHex("#AbC"), "#aabbcc");
  assert.equal(normHex("#A1B2C3D4"), "#a1b2c3d4");
});

test("invalid fields are reported, not saved", () => {
  const vals = full();
  vals.accent = "#12";
  vals.ansi3 = "";
  assert.deepEqual([...invalidKeys(vals)], ["accent", "ansi3"]);
  assert.deepEqual([...invalidKeys(full())], []);
});

test("saved JSON has the themes/*.json shape", () => {
  const vals = { ...full(), background: "#123", terminal_foreground: "#E6E6EA", foreground: "#eeeeef", selection: "#2f4170", cursor: "#ffffff", ansi15: "#f5f5f7" };
  const out = JSON.parse(JSON.stringify(themeJson(vals)));
  assert.deepEqual(Object.keys(out), ["background", "foreground", "selection", "cursor", "ansi", "colors"]);
  assert.equal(out.background, "#112233");
  assert.equal(out.foreground, "#e6e6ea"); // the terminal's text; panel text goes in colors
  assert.equal(out.colors.foreground, "#eeeeef");
  assert.equal(out.ansi.length, 16);
  assert.equal(out.ansi[15], "#f5f5f7");
  for (const k of ["background", "selection", "cursor", "terminal_foreground", "ansi0"]) assert.ok(!(k in out.colors), k);
  for (const k of ["canvas", "chrome", "accent", "working", "blocked", "done", "idle"]) assert.ok(validHex(out.colors[k]), k);
});

test("import reads a theme file back into the same fields", () => {
  const vals = full();
  const back = fromThemeJson(JSON.parse(JSON.stringify(themeJson(vals))));
  assert.deepEqual({ ...back }, vals);
  assert.throws(() => fromThemeJson([]), /JSON object/);
  assert.throws(() => fromThemeJson({ name: "x" }), /No theme colors/);
});

test("names become file-safe slugs", () => {
  assert.equal(slugify("  My Aurora Theme! "), "my-aurora-theme");
  assert.equal(slugify("../etc/passwd"), "etc-passwd");
  assert.equal(slugify("***"), "");
});
