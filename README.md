# Trailboss for Herdr

A [Herdr](https://herdr.dev) mod: Trailboss in the status bar and a dashboard on **Alt+Shift+T**. It's a thin frontend: everything it shows comes from the `trailboss` CLI's `--json` output.

## Install

```sh
git clone https://github.com/trailboss-ai/trailboss-herdr && cd trailboss-herdr
python3 install.py --get-cli              # the Trailboss CLI the mod runs, into ~/.local/bin
python3 install.py                        # --dry-run first to see what it changes
```

The installer:
- runs `herdr-app check` and copies `mods/trailboss/` to `~/.config/herdr-app/mods/`;
- binds **Alt+Shift+T** to the dashboard, **Alt+Shift+I** to the Insights window and **Alt+Shift+C** to the thread pane, unless a key is already taken (then it tells you; `--update` binds keys a newer mod added);
- adds a 320px block at the right of the current layout's status bar. If that layout is one of Herdr's own (`main`, …), which Herdr replaces on every start, it's cloned first as `<name>-trailboss` and switched to. A layout of your own is edited in place, after a backup in `~/.config/herdr-app/data/trailboss/backups/`.

`--update` copies a newer mod over an install, keeping (and naming) any file you changed since; `--uninstall` takes the block and the keys out and removes the mod.

The installer records what it installed in `~/.config/herdr-app/data/trailboss/install.json`: a SHA-256 of each file and the keys it bound. `trailboss doctor` checks your files and keys against it. Installed through Herdr's package manager, the dashboard writes it (files only, no keys) the first time you open it, from the files as they are then: a file you changed before that counts as installed that way.

**Installed through Herdr's package manager, or no CLI yet:** open the dashboard (`mod.open:trailboss`). It checks the CLI with `trailboss --json version` and, when it's missing or older than the mod needs, shows **Install** / **Update**: that downloads the release for your machine (Linux x86_64 or aarch64) to `~/.local/bin`, after checking its SHA-256. When the status-bar block isn't in the current layout, it offers **Add to layout**, which does what the installer does above. Both run `mods/trailboss/setup_mod.py`, which ships in the mod's folder (`install.py --get-cli` runs the same code), and only when you click.

**Offline:** download the release archive for your machine on another computer and put its `trailboss` binary in `~/.local/bin`.

**Replacing agent-resume-plus:** the installer refuses while it's installed, because both would resume the same terminals after a reboot. Uninstall it first (`python3 <herdr-agent-resume-plus>/scripts/install.py --uninstall`). Trailboss starts tracking from scratch; agent-resume-plus's tracked sessions aren't carried over.

## Replacing insights, session-history, stats and usage-bar

Trailboss does everything those four mods do. To swap them out:

```sh
python3 install.py --update                # the current mod first
python3 install.py --take-over --dry-run   # see what changes
python3 install.py --take-over
```

Their blocks in your layouts become Trailboss views, with the same ids and sizes, so panel buttons keep working: Sessions and Stats in the side panel, quotas in the status bar. Icons other mods borrowed from them (tabs-plus) now point at Trailboss's. The four mods are removed through Herdr's package manager, which keeps them in `data/pkg/removed/`. The layouts and edited mods are backed up in `data/trailboss/backups/`. Insights opens from the dashboard's **Insights ↗** button or **Alt+Shift+I** (which needs the status-bar block in the layout).

## Files and editor, agent-aware (opt-in)

```sh
python3 install.py --take-over-files     # --give-back-files undoes it
```

Your layout's Files panel becomes Trailboss's: the focused terminal's repository (or folder), with each changed file badged with the agent that changed it. A solid badge means exactly, from the agent's edit tool. An outlined `agent?` badge means probably, because the file changed while only that agent was working there. Folders with changes inside get a dot, and the footer says which session made the change and when. **Right-click** a file or folder (or empty space, for the top folder) for its menu: Open, New file, New folder, Rename / move, Copy name, Copy full path, Copy relative path, Reveal in file manager, Move to trash (asks first). **Drag** a file or folder onto another folder (or a file, meaning its folder, or empty space, meaning the top) to move it there. The toolbar does the same as the menu. Nothing is ever deleted outright: "delete" moves to the trash (`gio`, else `trash-cli`). Nothing overwrites an existing file, and everything stays inside the folder shown.

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
- **Undo file…** or **Undo session…** (each asks first) puts files back as they were before the session, from Claude Code's own backups. It skips files another session changed later, never touches agents' own folders, and keeps what it replaces in Trailboss's undo folder.

Local folders only.

## Spaces with folders (opt-in)

```sh
python3 install.py --take-over-spaces    # --give-back-spaces undoes it
```

Your layout's spaces list becomes Trailboss's: Herdr's own list (worktrees under their repo, branch and ahead/behind, a group per machine, colors, the right-click menu), with folders up to four levels deep.

- **New folder** at the top; right-click a folder for New space here, New folder inside, Edit… (name, color, start folder, rules), Show only this folder, Fold, Move the current space here, and Remove folder (its spaces stay).
- **Drag** a space onto a folder to put it there, onto a space to put it beside that one, or onto **Drop here for the top level**. Drag a folder onto another to nest it.
- **Rules** file spaces by themselves: a folder name anywhere in the path (`billing`), a path (`~/code/client-*`, `*` is one folder name), or a machine (`machine:vm-*`). The most specific rule wins; a space you put somewhere by hand stays there.
- A folded folder still shows ● when something in it needs you, and how many agents are working. Hover a space's status, or that ●, for why its agents need you ("codex needs you: Run a command").
- Herdr's next / previous space keys follow the list as it shows.

The folders live in `trailboss folders` (`~/.local/share/trailboss/folders.json`), so other frontends see the same ones.

## Thread

Press **Alt+Shift+C** in an agent's terminal (it needs the status-bar block in the layout). A pane opens to its right with only the conversation: each prompt you sent and the reply that came back, newest first, a band per day, and the turn's cost. Press it again to move to the pane.

- **Search** narrows the list to turns with every word, in the prompt or the reply.
- **Click a turn** to read it: the prompt and the reply as formatted Markdown (select text to copy part of it), and the turn's model, tokens, cost, time and tool results.
- **Copy reply**, **Copy prompt**, and **Copy code** for each code block.
- **Quote into the prompt** pastes the reply into the agent's prompt as a `>` quote, with a blank line for your comment. It goes through the clipboard, which it replaces, and never presses Enter.
- **Agent messages:** reports the agent sent into the session itself, such as a background task finishing, are hidden; the button shows them.

It follows the session running in that terminal, including a new one after `/clear`, and reloads as the agent works. It reads `trailboss thread`, which works for every agent Trailboss indexes; thinking and tool output aren't shown.

## What it does

**The block** shows agents running, how many are working or waiting for you, today's cost at API prices, and the Claude 5-hour window with its pace (red when it's on track to run out). A **Resume N** button appears when a terminal has lost its agent. Click the block for the dashboard.

In the background it runs `trailboss events` every 15 s, and notifies when an agent outside Herdr's own terminals (VS Code, a plain terminal) needs you, and why ("needs you: Run a command"), or finishes a turn of 30 s or more. Like the CLI's own notifications, it says only the kind of request unless `notifications.details` is `true` in Trailboss's config, then the request itself ("Run: npm test"). Herdr notifies about its own terminals itself. It also warns, wherever the agents run, when two are working in the same folder (and shows **⚠ N in one folder** in the block), when an agent has stopped making progress (**⚠ N stuck**), and once per plan window when usage is on pace to run out before it resets ("Claude 5h limit in ~40m at this pace"). Each look also records which session runs in which terminal. When Herdr starts it runs `trailboss resume --auto`, which brings back what a reboot lost (after a Herdr restart alone, use the button). A notification says what came back and what didn't, and why.

**The dashboard** (Alt+Shift+T, or click the block):

| Tab | Shows | Click a row to |
|---|---|---|
| Live | every running agent: terminal, status and for how long ("blocked 12m"), cost so far, session; under it why it needs you (else its turn), its model, effort and context ("Opus 5.5 · High · 38% context", the share standing out above 80%), and its CPU and memory. Agents that need you (or look stuck) come first, then finished, working and idle ones, pinned agents (`trailboss live --pin`) above them all. **By folder** (default) puts each folder's agents under its heading (⚠ when more than one is working), folders with the most urgent agent first, and indents agents under the agent that started them; **List** shows one row each. Lost sessions and a Resume now button | go to its terminal |
| Sessions | recent sessions; type to full-text search every agent's sessions | reopen that session in a new tab, in its folder |
| Usage | cost per day for two weeks; cost per model for 30 days | |
| Quota | plan windows, % used, reset time, pace | |
| Stats | merged PRs, agent cost per PR, time to merge (from GitHub through `gh`) | |

**Sending from Live:** check agents' rows, type a message in the bar at the bottom and click **Send** (`trailboss send --yes`): it's typed only where the agent is idle and in front, and never over a draft in its input. Each row says "checking…" for a moment, then what happened: **sent** (it started a turn), **held** (it holds it until its turn ends), **no reaction**, or **skipped** and why. The results stay until the next send or **Clear**; the checks stay too. **Queue** (`send --queue --yes`) does the same, but an agent mid-turn gets the message once that turn ends. Queued messages show under their agent's row with **Take back** (`trailboss queue rm`). They're typed only while something looks at the agents: the block does while it runs, as do `trailboss watch` and `trailboss events`. The bar says when nothing is looking.

## Notes

- The block has to stay in your layout: it's what keeps tracking sessions and resumes them after a reboot.
- `trailboss` is looked for on PATH, then in `~/.cargo/bin` and `~/.local/bin` (apps started from a desktop launcher often miss those on PATH).
- The mod states the oldest CLI it works with (`NEEDS` in `mods/trailboss/cli.js`); the status block says when the one it found is older, with an **Install** / **Update** button. Nothing is downloaded unless you click.
- Quota checks call Anthropic's and OpenAI's usage endpoints every 5 minutes; Stats asks GitHub only when you open that tab.

## Issues and contributing

Report problems in [trailboss-ai/trailboss](https://github.com/trailboss-ai/trailboss/issues) (issues are off here, so everything is in one place). Pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). The mod only uses the CLI's `--json` output, as described in [trailboss-specification](https://github.com/trailboss-ai/trailboss-specification).

## License

MIT ([LICENSE](LICENSE)). Parts come from other MIT-licensed mods: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
