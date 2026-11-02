#!/usr/bin/env python3
"""Install the Trailboss mod into Herdr app.

  python3 integrations/herdr/install.py              install
  python3 integrations/herdr/install.py --update     copy the mod over an earlier install
  python3 integrations/herdr/install.py --uninstall  take it out of your layouts and keys, remove the mod
  python3 integrations/herdr/install.py --take-over  put Trailboss where insights, session-history,
                                                     stats and usage-bar were, then remove those mods
  python3 integrations/herdr/install.py --take-over-files   show trailboss's agent-aware Files in the
                                                     Files panel (opt-in; --give-back-files undoes it)
  python3 integrations/herdr/install.py --take-over-changes the same for the Changes panel
                                                     (--give-back-changes undoes it)
  python3 integrations/herdr/install.py --get-cli    download the latest CLI release to
                                                     ~/.local/bin (Linux x86_64 / aarch64)
  add --dry-run to any of them to see what would change

It needs the Trailboss CLI installed: --get-cli, a release archive, or cargo install --path . It copies mods/trailboss,
binds alt-shift-t to the dashboard and alt-shift-i to Insights (refusing a key already in use), and adds the mod's
320px block at the right of the current layout's status bar: it has to be in the layout
to keep tracking sessions and to resume them after a reboot. Herdr's own layouts (main,
...) are replaced on every start, so one of those is cloned first as <name>-trailboss (and
switched to); a layout of your own is edited in place, after a backup in
data/trailboss/backups/.

Adapted from herdr-agent-resume-plus's installer (same author, MIT).
"""
import argparse
import hashlib
import io
import json
import platform
import tarfile
import urllib.request
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOD = "trailboss"
# Both would type resume commands into the same terminals after a reboot.
REPLACES = "agent-resume-plus"
# Mods Trailboss replaces with its own views (docs/parity.md), and the view each block becomes.
TAKES_OVER = {"session-history": "sessions", "stats": "stats", "usage-bar": "quota", "insights": None}
# Icons other mods (tabs-plus) borrow from the mods being removed.
ICONS = {"mods/stats/stats.svg": "mods/trailboss/icons/stats.svg",
         "mods/session-history/icon.svg": "mods/trailboss/icons/sessions.svg"}
STATUS = "workspace-status"
GENERATED = ("gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json", "__pycache__")
RELEASES = "https://github.com/trailboss-ai/trailboss/releases/latest/download"
BLOCK = {"id": MOD, "type": "block", "content": {"mod": MOD}, "size": {"px": 320}}


def get_cli(dry):
    """Download the latest release for this machine, check it against SHA256SUMS, and put the
    binary in ~/.local/bin."""
    arch = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(platform.machine().lower())
    if sys.platform != "linux" or not arch:
        sys.exit(f"No release build for {sys.platform} {platform.machine()}. Build it: cargo install --path .")
    name = f"trailboss-{arch}-unknown-linux-musl"
    dest = Path.home() / ".local/bin/trailboss"
    print(f"{dry}download {RELEASES}/{name}.tar.gz to {dest}")
    if dry:
        return
    fetch = lambda f: urllib.request.urlopen(f"{RELEASES}/{f}", timeout=60).read()
    data = fetch(f"{name}.tar.gz")
    sums = dict(line.split()[::-1] for line in fetch("SHA256SUMS").decode().splitlines() if line.strip())
    if sums.get(f"{name}.tar.gz") != hashlib.sha256(data).hexdigest():
        sys.exit("The download doesn't match its published checksum; nothing was installed.")
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        binary = tar.extractfile(f"{name}/trailboss")
        if binary is None:
            sys.exit("The release archive has no trailboss binary; nothing was installed.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".new")
        tmp.write_bytes(binary.read())
    tmp.chmod(0o755)
    tmp.replace(dest)
    print(subprocess.run([str(dest), "--version"], capture_output=True, text=True).stdout.strip(), "installed")


def herdr(*args):
    r = subprocess.run(["herdr-app", *args], capture_output=True, text=True, timeout=30)
    if r.returncode:
        sys.exit(f"herdr-app {' '.join(args)} failed:\n{r.stdout}{r.stderr}")
    return r.stdout


def has_mod(node, name):
    if isinstance(node, dict):
        if node.get("type") == "block" and node.get("content", {}).get("mod") == name:
            return True
        return any(has_mod(v, name) for v in node.values())
    return isinstance(node, list) and any(has_mod(v, name) for v in node)


def add_block(node):
    """Put BLOCK next to the status bar: into its row if it already has one, else wrap the
    status block in a row. True when added."""
    if isinstance(node, dict):
        kids = node.get("children")
        if isinstance(kids, list):
            for i, c in enumerate(kids):
                if isinstance(c, dict) and c.get("type") == "block" and c.get("content", {}).get("mod") == STATUS:
                    if node.get("type") == "row":
                        kids.append(dict(BLOCK))
                    else:
                        kids[i] = {"id": c.get("id", "status"), "type": "row", "size": c.get("size", {"px": 28}),
                                   "children": [{**c, "id": f"{c.get('id', 'status')}-original", "size": {"weight": 1}}, dict(BLOCK)]}
                    return True
        return any(add_block(v) for v in node.values())
    return isinstance(node, list) and any(add_block(v) for v in node)


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
PANELS = {"files": ("files", "files-wrap"), "changes": ("changes", "changes-wrap")}


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
    a = ap.parse_args()
    if a.get_cli:
        return get_cli("(dry run) " if a.dry_run else "")
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
    print(f"{dry}copy mods/{MOD}")
    if not a.dry_run:
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(HERE / "mods" / MOD, dest, ignore=shutil.ignore_patterns(*GENERATED))
        herdr("check", str(dest))
    if a.update:
        print("Updated.")
        return

    for section, binds in ours.items():
        for key, action in binds.items():
            have = keys.get(section, {}).get(key)
            if have and have != action:
                print(f"keys.json: {key} is already {have}; not bound. Bind another key to {action} by hand.")
            elif not have:
                print(f"{dry}keys.json: bind {key} to {action}")
                keys.setdefault(section, {})[key] = action
    if not a.dry_run:
        keys_path.write_text(json.dumps(keys, indent=2) + "\n")

    try:
        layout = json.loads((home / "shared.json").read_text()).get("layout") or "main"
    except (OSError, ValueError):
        layout = "main"
    path = home / "layouts" / f"{layout}.json"
    if not path.exists():
        sys.exit(f"Can't find the current layout ({path}). Add a block with \"mod\": \"{MOD}\" to your layout by hand.")
    tree = json.loads(path.read_text())
    if has_mod(tree, MOD):
        print(f"Layout '{layout}' already has the {MOD} block.")
        return
    if not add_block(json.loads(path.read_text())):
        print(f"Layout '{layout}' has no {STATUS} block. Add a block with \"mod\": \"{MOD}\" (about 320px wide) by hand.")
        return
    if f"layout:{layout}" in shipped:
        clone = f"{layout}-{MOD}"
        if (home / "layouts" / f"{clone}.json").exists():
            sys.exit(f"layouts/{clone}.json already exists. Switch to it, or delete it and run again.")
        print(f"{dry}'{layout}' is Herdr's own: clone it as '{clone}' and switch to it")
        if a.dry_run:
            return
        herdr("do", "layout.clone", json.dumps({"name": layout, "as": clone}))
        path = home / "layouts" / f"{clone}.json"
        tree = json.loads(path.read_text())
    elif not a.dry_run:
        backup = home / "data" / MOD / "backups" / f"{layout}.{time.strftime('%Y%m%d-%H%M%S')}.json"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)
        print(f"backed up {path.name} to {backup}")
    add_block(tree)
    print(f"{dry}{path.name}: {MOD} block added at the right of the status bar")
    if not a.dry_run:
        path.write_text(json.dumps(tree, indent=2) + "\n")


if __name__ == "__main__":
    main()
