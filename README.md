# Trailboss for Herdr

A [Herdr](https://herdr.dev) mod: Trailboss in the status bar and a dashboard on **Alt+Shift+T**. It's a thin frontend: everything it shows comes from the `trailboss` CLI's `--json` output.

## Install

```sh
cargo install --path .                    # from the Trailboss repo: the CLI the mod runs
python3 integrations/herdr/install.py     # --dry-run first to see what it changes
```

The installer:
- runs `herdr-app check` and copies `mods/trailboss/` to `~/.config/herdr-app/mods/`;
- binds **Alt+Shift+T** to the dashboard, unless that key is already taken (then it tells you);
- adds a 320px block at the right of the current layout's status bar. If that layout is one of Herdr's own (`main`, …), which Herdr replaces on every start, it's cloned first as `<name>-trailboss` and switched to. A layout of your own is edited in place, after a backup in `~/.config/herdr-app/data/trailboss/backups/`.

`--update` copies a newer mod over an install; `--uninstall` takes the block and the key out and removes the mod.

**Replacing agent-resume-plus:** the installer refuses while it's installed, because both would resume the same terminals after a reboot. Uninstall it first (`python3 <herdr-agent-resume-plus>/scripts/install.py --uninstall`). Trailboss starts tracking from scratch; agent-resume-plus's tracked sessions aren't carried over.

## Replacing insights, session-history, stats and usage-bar

Trailboss does everything those four mods do ([parity checklist](../../docs/parity.md)). To swap them out:

```sh
python3 integrations/herdr/install.py --update                # the current mod first
python3 integrations/herdr/install.py --take-over --dry-run   # see what changes
python3 integrations/herdr/install.py --take-over
```

Their blocks in your layouts become Trailboss views, with the same ids and sizes, so panel buttons keep working: Sessions and Stats in the side panel, quotas in the status bar. Icons other mods borrowed from them (tabs-plus) now point at trailboss's. The four mods are removed through Herdr's package manager, which keeps them in `data/pkg/removed/`. The layouts and edited mods are backed up in `data/trailboss/backups/`. Insights opens from the dashboard's **Insights ↗** button.

## Files and editor, agent-aware (opt-in)

```sh
python3 integrations/herdr/install.py --take-over-files     # --give-back-files undoes it
```

Your layout's Files panel becomes trailboss's: the focused terminal's repository (or folder), with each changed file badged with the agent that changed it. A solid badge means exactly, from the agent's edit tool. An outlined `agent?` badge means probably, because the file changed while only that agent was working there. Folders with changes inside get a dot, and the footer says which session made the change and when. **Right-click** a file or folder (or empty space, for the top folder) for its menu: Open, New file, New folder, Rename / move, Copy path, Reveal in file manager, Move to trash (asks first). **Drag** a file or folder onto another folder (or a file, meaning its folder, or empty space, meaning the top) to move it there. The toolbar does the same as the menu. Nothing is ever deleted outright: "delete" moves to the trash (`gio`, else `trash-cli`). Nothing overwrites an existing file, and everything stays inside the folder shown.

Files open in a **multi-tab editor** pane beside the terminal. It works alongside agents:

- **Saving never overwrites an agent's edit unseen.** A save only lands if the file is still what you opened. If it changed, you see which agent probably changed it, and can **Compare** (a diff in its own tab), **Reload**, or **Overwrite with mine**.
- **Live:** a file you haven't touched reloads by itself when an agent changes it, and says who.
- **Highlighting** follows the file type (Markdown, C/C++, Rust, JS/TS, Python, YAML, and more; Dockerfile and Makefile by name).
- **Word wrap** is on for Markdown and text, off for code; toggle it with the Wrap button or Alt+Z.
- **Find and replace** (Ctrl+F, Ctrl+H): match case, regex, a match count and a list of matching lines; Replace next, Replace all, and Undo replace. The editor can't select text, so matches are listed rather than highlighted in place.
- **Keys:** Ctrl+S saves, Ctrl+W closes (asking first if unsaved), Ctrl+Tab switches, Esc closes the find bar. Files over 1 MB and binary files open with a notice instead.

**Changes**, the same way (`--take-over-changes`, undone by `--give-back-changes`), shows the repository's uncommitted work in Staged and Changes sections. Each file has its +/− counts and the badge of the agent that changed it.
- Click a file for its diff.
- Stage, unstage or discard **a whole file or a single hunk**. Discarding asks first; discarding an untracked file moves it to the trash.
- **Commit** commits what's staged, or with nothing staged, everything (as Herdr's own Changes does).
- Git reads take no locks, so the panel never gets in the way of an agent running git in the same repository.

**Review by session:** the Changes panel's **By session ↗** opens a window:
- **Left:** the agent sessions that changed files in this repository.
- **Right:** the chosen session's files. Each shows whether it was modified or created, whether it's back as it was, and who changed it since.
- **Click a file** for its before → now diff.
- **Undo file…** or **Undo session…** (each asks first) puts files back as they were before the session, from Claude Code's own backups. It skips files another session changed later, never touches agents' own folders, and keeps what it replaces in trailboss's undo folder.

Local folders only.

## What it does

**The block** shows agents running, how many are working or waiting for you, today's cost at API prices, and the Claude 5-hour window with its pace (red when it's on track to run out). A **Resume N** button appears when a terminal has lost its agent. Click the block for the dashboard.

In the background it runs `trailboss events` every 15 s, and notifies when an agent outside Herdr's own terminals (VS Code, a plain terminal) needs you or finishes a turn of 30 s or more. Herdr notifies about its own terminals itself. Each look also records which session runs in which terminal. When Herdr starts it runs `trailboss resume --auto`, which brings back what a reboot lost (after a Herdr restart alone, use the button). A notification says what came back and what didn't, and why.

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
