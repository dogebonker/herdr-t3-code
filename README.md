# herdr-t3-code

T3 Code features, rebuilt as mods for [Herdr App](https://herdr.dev).

Each folder here is one thing you can add to Herdr. Take a single mod into the layout you already use, or take the whole T3 layout.

![The T3 layout](herdr-t3/preview.png)

| Folder | Kind | What it is |
| --- | --- | --- |
| [`t3-focus`](t3-focus) | mod | An inbox for your coding agents. The ones that need you sit on top, busy ones fold into Working, finished ones get settled or snoozed until later. Mark unread, multi-select, PR badges per agent, and "reference this agent" into another agent's prompt. |
| [`t3-theme`](t3-theme) | mod | A theme editor. Start from any theme, change its colors with a live preview, save it as your own. |
| [`herdr-t3`](herdr-t3) | layout | The whole window, T3 Code style: the Focus inbox or a Spaces + Agents sidebar, project favicons as space icons, slim tabs, framed panes, a one-agent view, a Files and Changes panel, and the theme editor. |

## Add one

Ask your Herdr agent, for example:

> Add herdr.dev/mods/dogebonker/t3-focus

> Add herdr.dev/layouts/dogebonker/herdr-t3

The agent reads the folder's `RECIPE.md` and files, tells you what the mod runs or reaches, copies it into `~/.config/herdr-app/`, merges its keys and checks it. Each folder's `RECIPE.md` also describes the thing well enough to rebuild it from scratch.

## Keys

| Key | Where | Does |
| --- | --- | --- |
| `cmd-shift-s` | t3-focus, layout | Settle the agent in view, or bring it back |
| `cmd-shift-t` | t3-theme, layout | Open the theme editor |
| `cmd-1` … `cmd-9` | layout only | Open the Nth Focus card (Herdr uses these for tabs elsewhere) |
| `cmd-shift-b` | layout only | Switch the sidebar between Focus and Spaces + Agents |
| `cmd-shift-a` | layout only | One-agent view on or off |
| `cmd-shift-e` | layout only | Files and Changes panel |

## Working on it

The layout's mods in `herdr-t3/mods/` are the source. `t3-focus/` and `t3-theme/` hold copies with their own `mod.json`, so after a change run `./sync.sh`.

Tests run against a fake Herdr API:

```sh
node --test herdr-t3/mods/t3-focus/check-focus.cjs
node --test herdr-t3/mods/t3-theme/check-theme.cjs
node herdr-t3/mods/t3-spaces/check-icons.cjs
```

`check-sidebar.cjs` and `check-pane.cjs` need Herdr's built-in icons, so run them from the installed copies in `~/.config/herdr-app/mods/`. `herdr-app check <mod folder>` loads a mod once and reports problems.

A new T3 feature goes in as its own folder with `mods/t3-<name>/`, a `RECIPE.md`, a `preview.png`, and a `keys.json` if it has keys.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
