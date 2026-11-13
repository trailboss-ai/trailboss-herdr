"""Checks for install.py's record of what it installed: python3 test_install.py

Runs the installer against a temporary HERDR_APP_HOME, with stand-ins for herdr-app and the
trailboss CLI on PATH.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "mods" / "trailboss"


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    home, bin_ = tmp / "herdr-app", tmp / "bin"
    bin_.mkdir()
    for name in ("herdr-app", "trailboss"):
        (bin_ / name).write_text("#!/bin/sh\nexit 0\n")
        (bin_ / name).chmod(0o755)
    (home / "layouts").mkdir(parents=True)
    status = {"id": "status", "type": "block", "content": {"mod": "workspace-status"}, "size": {"px": 28}}
    (home / "layouts" / "mine.json").write_text(json.dumps({"type": "column", "children": [status]}))
    (home / "shared.json").write_text(json.dumps({"layout": "mine"}))
    # alt-shift-i is taken: not bound, so not recorded.
    (home / "keys.json").write_text(json.dumps({"global": {"alt-shift-i": "something.else"}}))
    env = {**os.environ, "HERDR_APP_HOME": str(home), "PATH": f"{bin_}{os.pathsep}{os.environ['PATH']}"}
    record_path = home / "data" / "trailboss" / "install.json"
    dest = home / "mods" / "trailboss"

    def install(*args):
        r = subprocess.run([sys.executable, str(HERE / "install.py"), *args], capture_output=True, text=True, env=env)
        assert r.returncode == 0, r
        return r.stdout

    # A dry run writes no record.
    install("--dry-run")
    assert not record_path.exists()

    install()
    record = json.loads(record_path.read_text())
    files = record["files"]
    # Every installed file, relative to the mod's folder, with the SHA-256 of its bytes.
    assert "cli.js" in files and "icons/stats.svg" in files, sorted(files)
    for rel, want in files.items():
        assert not rel.startswith("/") and ".." not in Path(rel).parts, rel
        assert sha(dest / rel) == want == sha(SRC / rel), rel
    installed = {p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()}
    assert set(files) == installed, set(files) ^ installed
    # Herdr's generated files are left out.
    assert not any(Path(rel).name in ("gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json") or "__pycache__" in rel
                   for rel in files)
    # Only the keys it bound.
    ours = json.loads((HERE / "keys.json").read_text())["global"]
    assert record["keys"] == {"global": {k: v for k, v in ours.items() if k != "alt-shift-i"}}, record["keys"]

    # The dashboard's record step leaves the installer's record alone.
    before = record_path.read_text()
    r = subprocess.run([sys.executable, str(dest / "setup_mod.py"), "record"], capture_output=True, text=True, env=env)
    assert r.returncode == 0 and record_path.read_text() == before, r

    # --update keeps a file changed by hand, says so, and keeps its installed hash in the record.
    (dest / "cli.js").write_text("// changed by hand\n")
    out = install("--update", "--dry-run")
    assert "keep, changed since install: cli.js" in out, out
    assert (dest / "cli.js").read_text() == "// changed by hand\n"
    out = install("--update")
    assert "keep, changed since install: cli.js" in out, out
    assert (dest / "cli.js").read_text() == "// changed by hand\n"
    after = json.loads(record_path.read_text())
    assert after["files"]["cli.js"] == files["cli.js"], "the kept file keeps the hash it was installed with"
    assert {k: v for k, v in after["files"].items() if k != "cli.js"} == \
           {k: v for k, v in files.items() if k != "cli.js"}

    # A file removed by hand comes back.
    (dest / "lib.js").unlink()
    install("--update")
    assert sha(dest / "lib.js") == files["lib.js"]

    # Once the key is free, --update binds it and records it.
    keys = json.loads((home / "keys.json").read_text())
    del keys["global"]["alt-shift-i"]
    (home / "keys.json").write_text(json.dumps(keys))
    install("--update")
    assert json.loads(record_path.read_text())["keys"] == {"global": ours}

    # --uninstall removes the record (not on a dry run).
    install("--uninstall", "--dry-run")
    assert record_path.exists()
    out = install("--uninstall")
    assert "remove data/trailboss/install.json" in out, out
    assert not record_path.exists() and not dest.exists()

print("install record: ok")
