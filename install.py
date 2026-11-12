#!/usr/bin/env python3
"""Install the Trailboss mod into Herdr app.

  python3 install.py              install
  python3 install.py --update     copy the mod over an earlier install, keeping files you changed
  python3 install.py --uninstall  take it out of your layouts and keys, remove the mod
  python3 install.py --take-over  put Trailboss where insights, session-history,
                                                     stats and usage-bar were, then remove those mods
  python3 install.py --take-over-files   show trailboss's agent-aware Files in the
                                                     Files panel (opt-in; --give-back-files undoes it)
  python3 install.py --take-over-changes the same for the Changes panel
                                                     (--give-back-changes undoes it)
  python3 install.py --take-over-spaces  the spaces list with folders, in place of Herdr's
                                                     (--give-back-spaces undoes it)
  python3 install.py --get-cli    download the latest CLI release to
                                                     ~/.local/bin (Linux x86_64 / aarch64)
  add --dry-run to any of them to see what would change

It needs the Trailboss CLI installed: --get-cli or a release archive. It copies mods/trailboss,
binds alt-shift-t to the dashboard and alt-shift-i to Insights (refusing a key already in use), and adds the mod's
320px block at the right of the current layout's status bar: it has to be in the layout
to keep tracking sessions and to resume them after a reboot. Herdr's own layouts (main,
...) are replaced on every start, so one of those is cloned first as <name>-trailboss (and
switched to); a layout of your own is edited in place, after a backup in
data/trailboss/backups/.

What it installed (each file's SHA-256 and the keys it bound) goes in data/trailboss/install.json,
for `trailboss doctor`; --uninstall removes it.

Adapted from herdr-agent-resume-plus's installer (same author, MIT).
"""
import argparse
import fnmatch
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Downloading the CLI and adding the block live in the mod, which runs them itself when it was
# installed without this script (pkg installs only the mod's folder).
sys.path.insert(0, str(HERE / "mods" / "trailboss"))
from setup_mod import MOD, STATUS, add_to_layout, get_cli  # noqa: E402
# Both would type resume commands into the same terminals after a reboot.
REPLACES = "agent-resume-plus"
# Mods Trailboss replaces with its own views (docs/parity.md), and the view each block becomes.
TAKES_OVER = {"session-history": "sessions", "stats": "stats", "usage-bar": "quota", "insights": None}
# Icons other mods (tabs-plus) borrow from the mods being removed.
ICONS = {"mods/stats/stats.svg": "mods/trailboss/icons/stats.svg",
         "mods/session-history/icon.svg": "mods/trailboss/icons/sessions.svg"}
GENERATED = ("gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json", "__pycache__")
# What was installed, in Herdr's data/trailboss/: each file's SHA-256 (paths relative to the
# mod's folder) and the keys bound, so `trailboss doctor` can tell which files were changed since.
RECORD = Path("data") / MOD / "install.json"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mod_files(root):
    """The mod's files under root, as relative paths with /, leaving out Herdr's generated ones."""
    out = []
    for f in sorted(root.rglob("*")):
        rel = f.relative_to(root)
        if f.is_file() and not any(fnmatch.fnmatch(part, g) for part in rel.parts for g in GENERATED):
            out.append(rel.as_posix())
    return out


def read_record(home):
    try:
        record = json.loads((home / RECORD).read_text())
    except (OSError, ValueError):
        return {}
    return record if isinstance(record, dict) else {}


def changed_by_hand(dest, record):
    """Installed files whose bytes differ from the hash recorded when they were installed."""
    files = record.get("files")
    if not isinstance(files, dict):
        return []
    return [rel for rel, want in sorted(files.items())
            if (dest / rel).is_file() and sha256(dest / rel) != want]


def herdr(*args):
    r = subprocess.run(["herdr-app", *args], capture_output=True, text=True, timeout=30)
    if r.returncode:
        sys.exit(f"herdr-app {' '.join(args)} failed:\n{r.stdout}{r.stderr}")
    return r.stdout


def drop_block(node):
    """Remove every BLOCK; a status row left with only the status block is unwrapped. Count removed."""
    n = 0
    if isinstance(node, list):
        return sum(drop_block(v) for v in node)
    if not isinstance(node, dict):
        return 0
    for v in node.values():  # children first, so a row is emptied before we look at it
        n += drop_block(v)
    kids = node.get("children")
    if isinstance(kids, list):
        keep = [c for c in kids if not (isinstance(c, dict) and c.get("content", {}).get("mod") == MOD)]
        n += len(kids) - len(keep)
        for i, c in enumerate(keep):
            ck = c.get("children") if isinstance(c, dict) else None
            if c.get("type") == "row" and isinstance(ck, list) and len(ck) == 1 and ck[0].get("content", {}).get("mod") == STATUS \
                    and str(ck[0].get("id", "")).endswith("-original"):
                keep[i] = {**ck[0], "id": c.get("id"), "size": c.get("size")}
        node["children"] = keep
    return n


def take_over_blocks(node):
    """Point blocks of the replaced mods at Trailboss views, keeping their ids and sizes."""
    n = 0
    if isinstance(node, dict):
        c = node.get("content")
        if node.get("type") == "block" and isinstance(c, dict) and TAKES_OVER.get(c.get("mod")):
            node["content"] = {"mod": MOD, "props": {"view": TAKES_OVER[c["mod"]]}}
            n += 1
        n += sum(take_over_blocks(v) for v in node.values())
    elif isinstance(node, list):
        n += sum(take_over_blocks(v) for v in node)
    return n


# Herdr's own panels (or clones of them) that trailboss's agent-aware views can replace.
PANELS = {"files": ("files", "files-wrap"), "changes": ("changes", "changes-wrap"), "spaces": ("spaces",)}


def swap_panel(node, view, give_back):
    """Point a panel's blocks at Trailboss (remembering which mod was there), or back again."""
    n = 0
    if isinstance(node, dict):
        c = node.get("content")
        if node.get("type") == "block" and isinstance(c, dict):
            props = c.get("props") or {}
            if not give_back and c.get("mod") in PANELS[view]:
                node["content"] = {"mod": MOD, "props": {"view": view, "was": c["mod"]}}
                n += 1
            elif give_back and c.get("mod") == MOD and props.get("view") == view:
                node["content"] = {"mod": props.get("was") or view}
                n += 1
        n += sum(swap_panel(v, view, give_back) for v in node.values())
    elif isinstance(node, list):
        n += sum(swap_panel(v, view, give_back) for v in node)
    return n


def panel(home, shipped, dry, view, give_back):
    if not (home / "mods" / MOD).exists():
        sys.exit("Install Trailboss first.")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    done = 0
    for f in sorted((home / "layouts").glob("*.json")):
        if f"layout:{f.stem}" in shipped:
            continue
        tree = json.loads(f.read_text())
        if n := swap_panel(tree, view, give_back):
            done += n
            name = view.capitalize()
            what = f"the previous {name} panel again" if give_back else f"Trailboss's agent-aware {name}"
            print(f"{dry}{f.name}: {n} block(s) now show {what}")
            if not dry:
                backups = home / "data" / MOD / "backups"
                backups.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, backups / f"{f.stem}.{stamp}.json")
                f.write_text(json.dumps(tree, indent=2) + "\n")
    if not done:
        print(f"No {view.capitalize()} panel to swap in your layouts." if not give_back else "Nothing to give back.")


def take_over(home, shipped, dry):
    if not (home / "mods" / MOD).exists():
        sys.exit(f"Install Trailboss first (without --take-over).")
    backups = home / "data" / MOD / "backups"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for f in sorted((home / "layouts").glob("*.json")):
        if f"layout:{f.stem}" in shipped:
            continue
        tree = json.loads(f.read_text())
        if n := take_over_blocks(tree):
            print(f"{dry}{f.name}: {n} block(s) now show trailboss")
            if not dry:
                backups.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, backups / f"{f.stem}.{stamp}.json")
                f.write_text(json.dumps(tree, indent=2) + "\n")
    for js in sorted((home / "mods").glob("*/*.js")):
        if js.parent.name in TAKES_OVER or js.parent.name == MOD:
            continue
        text = js.read_text()
        new = text
        for old, ours in ICONS.items():
            new = new.replace(old, ours)
        if new != text:
            print(f"{dry}mods/{js.parent.name}/{js.name}: icons now from mods/{MOD}/icons")
            if not dry:
                backups.mkdir(parents=True, exist_ok=True)
                shutil.copy2(js, backups / f"{js.parent.name}-{js.name}.{stamp}")
                js.write_text(new)
    pkg = home / "mods" / "pkg" / "pkg.py"
    for name in TAKES_OVER:
        if not (home / "mods" / name).exists():
            continue
        print(f"{dry}remove mods/{name} (kept in data/pkg/removed/ or data/{MOD}/backups/)")
        if dry:
            continue
        r = subprocess.run([sys.executable, str(pkg), "remove", name, "--force"], capture_output=True, text=True) \
            if pkg.exists() else None
        if not r or r.returncode or '"ok": false' in (r.stdout or ""):
            # Not tracked by herdr-pkg: move it aside ourselves.
            backups.mkdir(parents=True, exist_ok=True)
            shutil.move(str(home / "mods" / name), str(backups / f"mod-{name}.{stamp}"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true")
    ap.add_argument("--get-cli", action="store_true")
    ap.add_argument("--uninstall", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--take-over", action="store_true")
    ap.add_argument("--take-over-files", action="store_true")
    ap.add_argument("--give-back-files", action="store_true")
    ap.add_argument("--take-over-changes", action="store_true")
    ap.add_argument("--give-back-changes", action="store_true")
    ap.add_argument("--take-over-spaces", action="store_true")
    ap.add_argument("--give-back-spaces", action="store_true")
    a = ap.parse_args()
    if a.get_cli:
        return get_cli(dry=a.dry_run)
    home = Path(os.environ.get("HERDR_APP_HOME", Path.home() / ".config/herdr-app"))
    if not (home / "layouts").is_dir():
        sys.exit(f"No Herdr app home at {home}. Start Herdr app once, or set HERDR_APP_HOME.")
    shipped = set(json.loads((home / "installed.json").read_text())) if (home / "installed.json").exists() else set()
    dry = "(dry run) " if a.dry_run else ""
    keys_path = home / "keys.json"
    keys = json.loads(keys_path.read_text()) if keys_path.exists() else {}
    ours = json.loads((HERE / "keys.json").read_text())

    if a.take_over:
        take_over(home, shipped, dry)
        return
    for view in PANELS:
        take, give = getattr(a, f"take_over_{view}"), getattr(a, f"give_back_{view}")
        if take or give:
            panel(home, shipped, dry, view, give)
            return

    if a.uninstall:
        for f in sorted((home / "layouts").glob("*.json")):
            if f"layout:{f.stem}" in shipped:
                continue
            tree = json.loads(f.read_text())
            if n := drop_block(tree):
                print(f"{dry}{f.name}: removed the {MOD} block")
                if not a.dry_run:
                    f.write_text(json.dumps(tree, indent=2) + "\n")
        for section, binds in ours.items():
            for key, action in binds.items():
                if keys.get(section, {}).get(key) == action:
                    print(f"{dry}keys.json: unbind {key}")
                    del keys[section][key]
        if not a.dry_run:
            keys_path.write_text(json.dumps(keys, indent=2) + "\n")
        if (home / "mods" / MOD).exists():
            print(f"{dry}remove mods/{MOD}")
            if not a.dry_run:
                shutil.rmtree(home / "mods" / MOD)
        if (home / RECORD).exists():
            print(f"{dry}remove {RECORD.as_posix()}")
            if not a.dry_run:
                (home / RECORD).unlink()
        print(f"Kept: any <name>-{MOD} layout the installer cloned, and trailboss's own data "
              "(~/.local/share/trailboss: the index and tracked.json).")
        return

    if (home / "mods" / REPLACES).exists():
        sys.exit(f"mods/{REPLACES} is installed. Trailboss replaces it, and both would resume the same "
                 f"terminals after a reboot. Uninstall it first:\n"
                 f"  python3 <herdr-agent-resume-plus>/scripts/install.py --uninstall")
    bin_ = shutil.which("trailboss") or next(
        (str(p) for p in (Path.home() / ".cargo/bin/trailboss", Path.home() / ".local/bin/trailboss") if p.exists()), None)
    if not bin_:
        sys.exit("The Trailboss CLI isn't installed. Get a release build with --get-cli, "
                 "or from the Trailboss repo: cargo install --path .")
    print(f"using {bin_}")
    dest = home / "mods" / MOD
    if dest.exists() and not a.update:
        sys.exit(f"mods/{MOD} already exists. Use --update to copy over it.")
    if a.update and not dest.exists():
        sys.exit(f"mods/{MOD} isn't installed yet: run without --update.")
    herdr("check", str(HERE / "mods" / MOD))
    record = read_record(home) if a.update else {}
    # Files changed by hand since the last install are kept, not copied over.
    keep = changed_by_hand(dest, record) if a.update else []
    if keep:
        print(f"{dry}keep, changed since install: {', '.join(keep)}")
    print(f"{dry}copy mods/{MOD}")
    src = HERE / "mods" / MOD
    if not a.dry_run:
        kept = {rel: (dest / rel).read_bytes() for rel in keep}
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns(*GENERATED))
        for rel, data in kept.items():
            (dest / rel).parent.mkdir(parents=True, exist_ok=True)
            (dest / rel).write_bytes(data)
        herdr("check", str(dest))
    # Keys a newer mod added are bound on --update too.
    bound = False
    for section, binds in ours.items():
        for key, action in binds.items():
            have = keys.get(section, {}).get(key)
            if have and have != action:
                if not a.update:
                    print(f"keys.json: {key} is already {have}; not bound. Bind another key to {action} by hand.")
            elif not have:
                print(f"{dry}keys.json: bind {key} to {action}")
                keys.setdefault(section, {})[key] = action
                bound = True
    if bound and not a.dry_run:
        keys_path.write_text(json.dumps(keys, indent=2) + "\n")
    if not a.dry_run:
        # A kept file keeps the hash it was installed with, so doctor still says it was changed.
        files = {rel: sha256(src / rel) for rel in mod_files(src)}
        files.update({rel: record["files"][rel] for rel in keep})
        # Only the keys bound to our actions: not the ones refused because the key was taken.
        made = {}
        for section, binds in ours.items():
            for key, action in binds.items():
                if keys.get(section, {}).get(key) == action:
                    made.setdefault(section, {})[key] = action
        (home / RECORD).parent.mkdir(parents=True, exist_ok=True)
        (home / RECORD).write_text(json.dumps({"files": files, "keys": made}, indent=2) + "\n")
    if a.update:
        print("Updated.")
        return

    add_to_layout(a.dry_run)


if __name__ == "__main__":
    main()
