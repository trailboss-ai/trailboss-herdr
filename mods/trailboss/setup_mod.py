#!/usr/bin/env python3
"""Setup steps the mod runs itself, so they work however it was installed (pkg installs only
this folder). install.py uses the same code.

  python3 setup_mod.py get-cli [--min 0.4.0] [--dry-run]
      download the latest Trailboss release for this machine to ~/.local/bin, after checking
      it against SHA256SUMS; refuse one older than --min
  python3 setup_mod.py add-block [--dry-run]
      add the Trailboss block to the current layout (cloning Herdr's own layout first)

Prints one line saying what happened; exits non-zero when it didn't.
"""
import argparse
import hashlib
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

MOD = "trailboss"
STATUS = "workspace-status"
RELEASES = "https://github.com/trailboss-ai/trailboss/releases/latest/download"
BLOCK = {"id": MOD, "type": "block", "content": {"mod": MOD}, "size": {"px": 320}}
DEST = Path.home() / ".local/bin/trailboss"


def asset(system, machine):
    """The release archive's name for this OS and CPU, or None when there's no build for it."""
    arch = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(machine.lower())
    if not system.startswith("linux") or not arch:
        return None
    return f"trailboss-{arch}-unknown-linux-musl"


def version_tuple(v):
    """'0.10.2' -> (0, 10, 2); anything after a '-' (pre-release) is ignored."""
    return tuple(int(p) if p.isdigit() else 0 for p in v.split("-")[0].split("."))


def get_cli(minimum=None, dry=False):
    name = asset(sys.platform, platform.machine())
    if not name:
        sys.exit(f"No Trailboss build for {sys.platform} {platform.machine()} yet.")
    if dry:
        print(f"(dry run) download {RELEASES}/{name}.tar.gz to {DEST}")
        return
    def fetch(f):
        try:
            return urllib.request.urlopen(f"{RELEASES}/{f}", timeout=60).read()
        except OSError as e:
            sys.exit(f"Couldn't download {RELEASES}/{f}: {getattr(e, 'reason', e)}. Nothing was installed.")
    data = fetch(f"{name}.tar.gz")
    sums = dict(line.split()[::-1] for line in fetch("SHA256SUMS").decode().splitlines() if line.strip())
    if sums.get(f"{name}.tar.gz") != hashlib.sha256(data).hexdigest():
        sys.exit("The download doesn't match its published checksum; nothing was installed.")
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        binary = tar.extractfile(f"{name}/trailboss")
        if binary is None:
            sys.exit("The release archive has no trailboss binary; nothing was installed.")
        DEST.parent.mkdir(parents=True, exist_ok=True)
        tmp = DEST.with_suffix(".new")
        tmp.write_bytes(binary.read())
    tmp.chmod(0o755)
    got = subprocess.run([str(tmp), "--version"], capture_output=True, text=True).stdout.split()[-1:]
    got = got[0] if got else "?"
    # The mod checks a build with `trailboss --json version`: one without it is too old for it.
    knows = subprocess.run([str(tmp), "--json", "version"], capture_output=True, text=True).returncode == 0
    if not knows or (minimum and version_tuple(got) < version_tuple(minimum)):
        tmp.unlink()
        need = f"{minimum} or newer" if knows and minimum else "a newer one (with `trailboss version`)"
        sys.exit(f"The latest release is {got}; the mod needs {need}. Nothing was installed.")
    tmp.replace(DEST)
    on_path = str(DEST.parent) in os.environ.get("PATH", "").split(os.pathsep)
    print(f"Installed Trailboss {got} in {DEST.parent}"
          + ("" if on_path else f". Add {DEST.parent} to your PATH to run trailboss in a terminal."))


def app_home():
    return Path(os.environ.get("HERDR_APP_HOME") or Path.home() / ".config/herdr-app")


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


def shipped(home):
    """What Herdr ships and replaces on every start ("layout:main", ...), from installed.json."""
    try:
        return set(json.loads((home / "installed.json").read_text()))
    except (OSError, ValueError):
        return set()


def add_to_layout(dry=False):
    """Add the block to the current layout. Herdr's own layouts are cloned as <name>-trailboss
    (and switched to); a layout of your own is edited in place, after a backup."""
    home = app_home()
    pre = "(dry run) " if dry else ""
    try:
        layout = json.loads((home / "shared.json").read_text()).get("layout") or "main"
    except (OSError, ValueError):
        layout = "main"
    path = home / "layouts" / f"{layout}.json"
    if not path.exists():
        sys.exit(f"Can't find the current layout ({path}). Add a block with \"mod\": \"{MOD}\" to it by hand.")
    tree = json.loads(path.read_text())
    if has_mod(tree, MOD):
        print(f"Layout '{layout}' already has the {MOD} block.")
        return
    if not add_block(json.loads(path.read_text())):
        sys.exit(f"Layout '{layout}' has no {STATUS} block. Add a block with \"mod\": \"{MOD}\" (about 320px wide) by hand.")
    if f"layout:{layout}" in shipped(home):
        clone = f"{layout}-{MOD}"
        if (home / "layouts" / f"{clone}.json").exists():
            sys.exit(f"layouts/{clone}.json already exists. Switch to it, or delete it and try again.")
        print(f"{pre}'{layout}' is Herdr's own: clone it as '{clone}' and switch to it")
        if dry:
            return
        r = subprocess.run(["herdr-app", "do", "layout.clone", json.dumps({"name": layout, "as": clone})],
                           capture_output=True, text=True, timeout=30)
        if r.returncode:
            sys.exit(f"Couldn't clone layout '{layout}': {(r.stderr or r.stdout).strip()}")
        path = home / "layouts" / f"{clone}.json"
        tree = json.loads(path.read_text())
    elif not dry:
        backup = home / "data" / MOD / "backups" / f"{layout}.{time.strftime('%Y%m%d-%H%M%S')}.json"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)
        print(f"backed up {path.name} to {backup}")
    add_block(tree)
    print(f"{pre}{path.name}: {MOD} block added at the right of the status bar")
    if not dry:
        path.write_text(json.dumps(tree, indent=2) + "\n")


def main():
    ap = argparse.ArgumentParser(description="Trailboss mod setup")
    ap.add_argument("step", choices=["get-cli", "add-block"])
    ap.add_argument("--min", help="refuse a release older than this version")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    try:
        if a.step == "get-cli":
            get_cli(a.min, a.dry_run)
        else:
            add_to_layout(a.dry_run)
    except OSError as e:  # network and file errors: one readable line for the mod to show
        sys.exit(f"{a.step} failed: {e}")


if __name__ == "__main__":
    main()
