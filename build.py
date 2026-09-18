#!/usr/bin/env python3
"""Inline src/ into two files:
dist/margin.html  page content for publishing as an artifact (no doctype or head, per the artifact contract)
dist/index.html   the same page wrapped in a full HTML document, for local preview
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
SCRIPTS = ["util.js", "config.js", "data.js", "engine.js", "ai.js", "account.js", "views.js", "app.js"]


def build():
    page = (SRC / "index.html").read_text()
    css = (SRC / "styles.css").read_text()
    js = "\n".join((SRC / "js" / name).read_text() for name in SCRIPTS)
    page = page.replace("<!-- STYLES -->", "<style>\n" + css + "\n</style>")
    page = page.replace("<!-- SCRIPTS -->", "<script>\n" + js + "\n</script>")
    DIST.mkdir(exist_ok=True)
    (DIST / "margin.html").write_text(page)
    head, _, body = page.partition('<div class="app">')
    full = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + head + '</head>\n<body>\n<div class="app">' + body + '</body>\n</html>\n'
    )
    (DIST / "index.html").write_text(full)
    # Privacy Policy and Terms are plain standalone pages.
    for f in (SRC / "legal").iterdir():
        shutil.copy(f, DIST / f.name)
    print("built", DIST / "margin.html", len(page) // 1024, "KB")


if __name__ == "__main__":
    build()
