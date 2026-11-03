// Space avatars, one rule for every Herdr T3 mod that draws them. Mods can't import across folders,
// so this file is copied byte for byte into each (t3-spaces keeps the original; check-icons.cjs
// fails when a copy differs). A space shows, in order:
// - the icon picked for it: shared "space.icons", id -> {kind: "file", path} (a path image() takes,
//   relative to the app's folder; Herdr's icons/*.svg glyphs go white on the space's color) or
//   {kind: "none"} (the letter); absent or {kind: "auto"}: automatic;
// - automatic: its folder's favicon, as t3-spaces found it (shared "space.favicons", id -> path);
// - its first letter on its color (shared "space.colors").
import { image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, theme, exec, appHome } from "herdr";
import * as fs from "fs/promises";

// What a stored color name looks like on an avatar: one strong color per hue, light and dark alike.
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// Where T3 Code looks for a project's favicon, in its order: well-known files, then the icon a page links to.
export const FAVICONS = ["favicon.svg", "favicon.ico", "favicon.png", "public/favicon.svg", "public/favicon.ico", "public/favicon.png",
  "app/favicon.ico", "app/favicon.png", "app/icon.svg", "app/icon.png", "app/icon.ico", "src/favicon.ico", "src/favicon.svg",
  "src/app/favicon.ico", "src/app/icon.svg", "src/app/icon.png", "assets/icon.svg", "assets/icon.png", "assets/logo.svg",
  "assets/logo.png", ".idea/icon.svg", "Resources/AppIcon.icns", "AppIcon.icns"];
export const PAGES = ["index.html", "public/index.html", "app/routes/__root.tsx", "src/routes/__root.tsx", "app/root.tsx", "src/root.tsx", "src/index.html"];

// <link rel="icon" href="..."> in HTML, or { rel: "icon", href: "..." } in a route's head().
export function iconHref(source) {
  const html = source.match(/<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i);
  if (html?.[1]) return html[1];
  for (const run of source.split("}")) {
    if (!/\brel\s*:\s*["'](?:icon|shortcut icon)["']/i.test(run)) continue;
    const href = run.match(/\bhref\s*:\s*["']([^"'?]+)/i);
    if (href?.[1]) return href[1];
  }
  return null;
}

// The favicon file under `root`, or null. `exists(path)` and `read(path)` (text or null) are given.
export async function findFavicon(root, exists, read) {
  for (const c of FAVICONS) if (await exists(`${root}/${c}`)) return `${root}/${c}`;
  for (const page of PAGES) {
    const href = iconHref((await read(`${root}/${page}`).catch(() => null)) ?? "");
    // Only a file in the project: no URLs, nothing above it.
    if (!href || /^([a-z]+:|\/\/)/i.test(href) || href.split("/").includes("..")) continue;
    const clean = href.replace(/^\//, "");
    for (const c of [`public/${clean}`, clean]) if (await exists(`${root}/${c}`)) return `${root}/${c}`;
  }
  return null;
}

// A picture as image() can draw it: a 64px PNG under data/space-icons, made once by macOS sips
// (.ico, .icns, SVG and big PNGs alike). Null when it can't be read.
// ponytail: keyed by the source path only; a changed file keeps its old picture until data/space-icons is cleared.
export async function cacheImage(src) {
  let h = 2166136261;
  for (const ch of src) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  const rel = `data/space-icons/${h.toString(16)}.png`, out = `${appHome()}/${rel}`;
  try {
    if (await fs.exists(out)) return rel;
    await fs.mkdir(`${appHome()}/data/space-icons`, { recursive: true });
    const r = await exec("sips", ["-s", "format", "png", "-Z", "64", src, "--out", out]);
    return r.code === 0 && (await fs.exists(out)) ? rel : null;
  } catch { return null; }
}

// The picture a space shows instead of its letter, or null.
export function spaceIcon(id) {
  const pick = (shared("space.icons") ?? {})[id];
  if (pick?.kind === "none") return null;
  if (pick?.kind === "file" && pick.path) return pick.path;
  return (shared("space.favicons") ?? {})[id] ?? null;
}

// A space's avatar, `size` px square with `radius` corners.
export function avatar(id, name, size, radius = 5) {
  const icon = spaceIcon(id);
  if (icon && !icon.startsWith("icons/")) return image(icon).size(size).flex_none().rounded(radius);
  const t = theme(), color = (shared("space.colors") ?? {})[id] ?? "ansi6";
  const tile = h_flex().size(size).flex_none().rounded(radius).bg(color.startsWith("#") ? color : MARK[color] ?? t[color]).items_center().justify_center();
  if (icon) return tile.child(svg(icon).size(Math.round(size * 0.62)).text_color("#ffffff"));
  return tile.text_size(size * 0.61).font_bold().text_color("#ffffff").child([...(name ?? "")][0]?.toUpperCase() ?? "?");
}
