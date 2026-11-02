# Trailboss for Herdr

A [Herdr](https://herdr.dev) mod: trailboss in the status bar and a dashboard on **Alt+Shift+T**. It's a thin frontend: everything it shows comes from the `trailboss` CLI's `--json` output.

## Install

```sh
cargo install --path .                    # from the trailboss repo: the CLI the mod runs
python3 integrations/herdr/install.py     # --dry-run first to see what it changes
```

The installer:
- runs `herdr-app check` and copies `mods/trailboss/` to `~/.config/herdr-app/mods/`;
- binds **Alt+Shift+T** to the dashboard, unless that key is already taken (then it tells you);
- adds a 320px block at the right of the current layout's status bar. If that layout is one of Herdr's own (`main`, …), which Herdr replaces on every start, it's cloned first as `<name>-trailboss` and switched to. A layout of your own is edited in place, after a backup in `~/.config/herdr-app/data/trailboss/backups/`.

`--update` copies a newer mod over an install; `--uninstall` takes the block and the key out and removes the mod.

**Replacing agent-resume-plus:** the installer refuses while it's installed, because both would resume the same terminals after a reboot. Uninstall it first (`python3 <herdr-agent-resume-plus>/scripts/install.py --uninstall`). Trailboss starts tracking from scratch; agent-resume-plus's tracked sessions aren't carried over.

## What it does

**The block** shows agents running, how many are working or waiting for you, today's cost at API prices, and the Claude 5-hour window with its pace (red when it's on track to run out). A **Resume N** button appears when a terminal has lost its agent. Click the block for the dashboard.

In the background it runs `trailboss live` every 15 s, which also records which session runs in which terminal. When Herdr starts it runs `trailboss resume --auto`, which brings back what a reboot lost (after a Herdr restart alone, use the button). A notification says what came back and what didn't, and why.

**The dashboard** (Alt+Shift+T, or click the block):

| Tab | Shows | Click a row to |
|---|---|---|
| Live | every running agent: terminal, status, cost so far, session; lost sessions and a Resume now button | go to its terminal |
| Search | full-text search across every agent's sessions | reopen that session in a new tab, in its folder |
| Usage | cost per day for two weeks; cost per model for 30 days | |
| Quota | plan windows, % used, reset time, pace | |
| Stats | merged PRs, agent cost per PR, time to merge (from GitHub through `gh`) | |

## Notes

- The block has to stay in your layout: it's what keeps tracking sessions and resumes them after a reboot.
- `trailboss` is looked for on PATH, then in `~/.cargo/bin` and `~/.local/bin` (apps started from a desktop launcher often miss those on PATH).
- Quota checks call Anthropic's and OpenAI's usage endpoints every 5 minutes; Stats asks GitHub only when you open that tab.
