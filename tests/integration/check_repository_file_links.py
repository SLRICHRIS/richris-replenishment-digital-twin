"""Check project/browser references, source boundaries and downloadable kit integrity.

Run from the repository root:
    python tests/integration/check_repository_file_links.py
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from collections import Counter
import json
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
sys.path.insert(0, str(ROOT))
from tools.build_dashboard_downloads import KIT_SOURCES, EDGE_KIT_README, build


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
        self.identifiers = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in {"src", "href"} and value:
                self.references.append(value)
            elif key == "id" and value:
                self.identifiers.append(value)


def check():
    checked = 0
    errors = []

    def inspect(owner, reference, worker=False):
        nonlocal checked
        value = reference.strip()
        if not value or value.startswith(("#", "//")):
            return
        parsed = urlsplit(value)
        if parsed.scheme:
            return
        relative = unquote(parsed.path)
        if not relative:
            return
        base = FRONTEND if worker else owner.parent
        destination = (base / relative).resolve()
        checked += 1
        if not destination.is_relative_to(ROOT) or not destination.exists():
            errors.append(f"{owner.relative_to(ROOT)} -> {reference}")
        if owner.suffix in {".js", ".html", ".css"} and owner.is_relative_to(FRONTEND):
            if not destination.is_relative_to(FRONTEND):
                errors.append(f"Browser dependency leaves frontend: {owner.relative_to(ROOT)} -> {reference}")

    files = [
        path for path in ROOT.rglob("*")
        if path.is_file()
        and not {"node_modules", "__pycache__", ".git", ".pytest_cache", ".venv", "runtime"}.intersection(path.relative_to(ROOT).parts)
    ]
    for path in files:
        if path.suffix not in {".html", ".js", ".css", ".md"}:
            continue
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".html":
            page = PageReferences()
            page.feed(text)
            duplicate_ids = [name for name, count in Counter(page.identifiers).items() if count > 1]
            assert not duplicate_ids, (path, duplicate_ids)
            for reference in page.references:
                inspect(path, reference)
        elif path.suffix == ".css":
            for match in re.finditer(r"""url\(\s*['"]?([^'")]+)""", text):
                inspect(path, match.group(1).strip())
        elif path.suffix == ".js":
            for expression in [r"""\bfrom\s*['"]([^'"]+)['"]""", r"""\bimport\s*\(\s*['"]([^'"]+)['"]"""]:
                for match in re.finditer(expression, text):
                    if match.group(1).startswith("."):
                        inspect(path, match.group(1))
            for match in re.finditer(r"""\bnew\s+Worker\s*\(\s*['"]([^'"]+)['"]""", text):
                inspect(path, match.group(1), worker=True)
        else:
            for match in re.finditer(r"\[[^\]]+\]\(([^)\s]+)\)", text):
                inspect(path, match.group(1))

    sketch = ROOT / "firmware/esp32_robot_telemetry/esp32_robot_telemetry.ino"
    assert sketch.stem == sketch.parent.name
    assert '#include "robot_connection_settings.h"' in sketch.read_text()
    assert (sketch.parent / "robot_connection_settings.example.h").is_file()
    assert not (sketch.parent / "robot_connection_settings.h").exists()

    kit_counts = {}
    for filename, sources in KIT_SOURCES.items():
        with zipfile.ZipFile(FRONTEND / "downloads" / filename) as archive:
            assert archive.testzip() is None, filename
            expected_names = set(sources)
            if filename == "mqtt_observation_recorder_starter_kit.zip":
                expected_names.add("README.md")
            assert set(archive.namelist()) == expected_names, filename
            assert len(archive.namelist()) == len(expected_names), filename
            for name in archive.namelist():
                assert not Path(name).is_absolute() and ".." not in Path(name).parts, name
                assert Path(name).name != "robot_connection_settings.h", name
                expected = EDGE_KIT_README.encode("utf-8") if name == "README.md" else (ROOT / name).read_bytes()
                assert archive.read(name) == expected, (filename, name)
            kit_counts[filename] = len(expected_names)
    build(check=True)

    ignored = (ROOT / ".gitignore").read_text()
    assert "firmware/esp32_robot_telemetry/robot_connection_settings.h" in ignored
    assert "backend/edge/config.json" in ignored
    assert ".streamlit/secrets.toml" in ignored
    assert not [p for p in FRONTEND.rglob("*") if p.is_file() and p.suffix in {".py", ".ino", ".h"}]
    assert not list((ROOT / "backend").rglob("*.js"))
    assert not (ROOT / "digital_twin_application").exists()
    assert not (ROOT / "automated_tests").exists()
    for expected in ["frontend/index.html", "backend/streamlit_dashboard_host.py", "streamlit_app.py", "requirements.txt"]:
        assert (ROOT / expected).is_file(), expected

    manifest = json.loads((ROOT / "docs/verification/repository_path_migration.json").read_text())
    assert len(manifest["files"]) == 104
    assert len({row["current_path"] for row in manifest["files"]}) == 104
    for row in manifest["files"]:
        assert (ROOT / row["current_path"]).is_file(), row

    assert not errors, "Broken local references:\n" + "\n".join(errors)
    print(f"PASS: {checked} local references; browser imports and document-relative workers; unique HTML IDs; "
          f"frontend/backend/firmware boundaries; 104-file migration coverage; "
          f"kit source matches {kit_counts}; private settings excluded; Streamlit entrypoint retained.")


if __name__ == "__main__":
    check()


