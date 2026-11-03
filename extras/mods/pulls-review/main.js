// Opens the focused pane's worktree in the installed PWA (`pulls.review -d --pwa`):
// starts the daemon if needed, then reviews its uncommitted changes when there are
// any, else what pulls.review opens by default. Bound in keys.json as `mod.open:pulls-review`.

import { View } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, exec, notify, props, closeOverlay, theme } from "herdr";

// Same lookup as the shipped `changes` mod.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

export default class PullsReview extends View {
  init(_props, cx) {
    const { cwd, on } = location();
    const fail = (body) => notify({ title: "pulls.review", body, level: "error" });
    cx.spawn(async () => {
      try {
        // The daemon listens on this machine's loopback only.
        if (on) return fail(`Only local folders, not ${on}.`);
        if (!cwd) return fail("No folder for the focused pane.");
        // Reads that write nothing under .git, as the shipped changes mod reads.
        const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], { cwd });
        if (status.code !== 0) return fail("Not a git repository.");
        const r = await exec("pulls.review", ["-d", "--pwa", ...(status.stdout.trim() ? ["--worktree"] : [])], { cwd });
        if (r.code !== 0) fail((r.stderr || r.stdout).trim() || `exit ${r.code}`);
      } catch (error) { fail(String(error)); }
      finally { closeOverlay(props().overlay); }
    });
  }

  render() {
    const t = theme();
    return h_flex().size_full().px(14).items_center().bg(t.popover).text_color(t.muted).text_size(13).child("Opening pulls.review…");
  }
}
