// The theme file's shape (themes/<name>.json) and the editor's color groups.
// No herdr imports: check-theme.cjs runs this file under node.

const ANSI_NAMES = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];

export const GROUPS = [
  { title: "Surfaces", fields: [
    ["canvas", "Canvas"], ["chrome", "Sidebar & bars"], ["background", "Terminal"], ["surface", "Surface"],
    ["popover", "Popover"], ["raised", "Raised"], ["hover", "Hover"], ["selected", "Selected"],
    ["border", "Border"], ["input", "Input border"]] },
  { title: "Text", fields: [
    ["foreground", "Text"], ["muted", "Muted text"], ["dim", "Dim text"],
    ["terminal_foreground", "Terminal text"], ["cursor", "Cursor"], ["selection", "Selection"]] },
  { title: "Accent", fields: [
    ["accent", "Accent"], ["accent_foreground", "On accent"], ["solid", "Button"],
    ["solid_foreground", "On button"], ["ring", "Focus ring"]] },
  { title: "Status", fields: [
    ["working", "Working"], ["blocked", "Blocked"], ["done", "Done"], ["idle", "Idle"], ["unknown", "Unknown"]] },
  { title: "Terminal ANSI", fields: Array.from({ length: 16 }, (_, i) =>
    [`ansi${i}`, `${i < 8 ? "" : "Bright "}${ANSI_NAMES[i % 8]}`]) },
];

export const KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f[0]));

// Keys that live at the file's top level rather than in `colors`.
const TOP = ["background", "selection", "cursor"];

export function validHex(s) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(s ?? "").trim());
}

// #abc -> #aabbcc, lowercased; #rrggbb and #rrggbbaa stay as typed.
export function normHex(s) {
  const v = String(s).trim().toLowerCase();
  return v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v;
}

export function slugify(name) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// The editor's KEYS that fail validation.
export function invalidKeys(vals) {
  return KEYS.filter((k) => !validHex(vals[k]));
}

// Editor values -> theme file object. Callers check invalidKeys first.
export function themeJson(vals) {
  const out = {
    background: normHex(vals.background),
    foreground: normHex(vals.terminal_foreground),
    selection: normHex(vals.selection),
    cursor: normHex(vals.cursor),
    ansi: Array.from({ length: 16 }, (_, i) => normHex(vals[`ansi${i}`])),
    colors: {},
  };
  for (const k of KEYS) if (!TOP.includes(k) && k !== "terminal_foreground" && !k.startsWith("ansi")) out.colors[k] = normHex(vals[k]);
  return out;
}

// A theme file object (or a flat {name: hex} map) -> editor values it sets.
export function fromThemeJson(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("Paste a JSON object.");
  const vals = {};
  const take = (k, v) => { if (typeof v === "string" && KEYS.includes(k)) vals[k] = v; };
  for (const [k, v] of Object.entries(obj)) if (k !== "foreground") take(k, v);
  // A theme file's top-level foreground is the terminal's; a flat theme() dump names both.
  if (typeof obj.foreground === "string") vals["terminal_foreground" in obj ? "foreground" : "terminal_foreground"] = obj.foreground;
  if (Array.isArray(obj.ansi)) obj.ansi.slice(0, 16).forEach((v, i) => take(`ansi${i}`, v));
  if (obj.colors && typeof obj.colors === "object") for (const [k, v] of Object.entries(obj.colors)) take(k, v);
  if (!Object.keys(vals).length) throw new Error("No theme colors found.");
  return vals;
}
