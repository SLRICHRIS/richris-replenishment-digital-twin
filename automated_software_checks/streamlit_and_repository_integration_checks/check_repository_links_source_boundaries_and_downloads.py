"""Check project/browser references, source boundaries and downloadable kit integrity.

Run from the repository root:
    python automated_software_checks/streamlit_and_repository_integration_checks/check_repository_links_source_boundaries_and_downloads.py
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
FRONTEND = ROOT / "frontend_warehouse_dashboard"
sys.path.insert(0, str(ROOT))
from project_maintenance_scripts.rebuild_dashboard_downloads_from_sources import (
    KIT_SOURCES,
    EDGE_KIT_README,
    build,
)


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
        # FastAPI mounts research_baseline/web at /assets; these are HTTP-root
        # references, not filesystem absolute paths.
        if owner.is_relative_to(ROOT / "research_baseline/web") and relative.startswith("/assets/"):
            destination = (ROOT / "research_baseline/web" / relative.removeprefix("/assets/")).resolve()
        else:
            destination = (base / relative).resolve()
        checked += 1
        if not destination.is_relative_to(ROOT) or not destination.exists():
            errors.append(f"{owner.relative_to(ROOT)} -> {reference}")
        if owner.suffix in {".js", ".html", ".css"} and owner.is_relative_to(FRONTEND):
            if not destination.is_relative_to(FRONTEND):
                errors.append(
                    f"Browser dependency leaves frontend_warehouse_dashboard: {owner.relative_to(ROOT)} -> {reference}"
                )

    files = [
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and not {
            "node_modules",
            "__pycache__",
            ".git",
            ".pytest_cache",
            ".venv",
            "runtime",
        }.intersection(path.relative_to(ROOT).parts)
    ]
    for path in files:
        if path.suffix not in {".html", ".js", ".css", ".md"}:
            continue
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".html":
            page = PageReferences()
            page.feed(text)
            duplicate_ids = [
                name for name, count in Counter(page.identifiers).items() if count > 1
            ]
            assert not duplicate_ids, (path, duplicate_ids)
            for reference in page.references:
                inspect(path, reference)
        elif path.suffix == ".css":
            for match in re.finditer(r"""url\(\s*['"]?([^'")]+)""", text):
                inspect(path, match.group(1).strip())
        elif path.suffix == ".js":
            for expression in [
                r"""\bfrom\s*['"]([^'"]+)['"]""",
                r"""\bimport\s*\(\s*['"]([^'"]+)['"]""",
            ]:
                for match in re.finditer(expression, text):
                    if match.group(1).startswith("."):
                        inspect(path, match.group(1))
            for match in re.finditer(
                r"""\bnew\s+Worker\s*\(\s*['"]([^'"]+)['"]""", text
            ):
                inspect(path, match.group(1), worker=True)
        else:
            for match in re.finditer(r"\[[^\]]+\]\(([^)\s]+)\)", text):
                inspect(path, match.group(1))

    sketch = (
        ROOT
        / "esp32_telemetry_firmware/publish_esp32_robot_telemetry/publish_esp32_robot_telemetry.ino"
    )
    assert sketch.stem == sketch.parent.name
    assert '#include "esp32_wifi_and_mqtt_settings.h"' in sketch.read_text()
    assert (sketch.parent / "example_esp32_wifi_and_mqtt_settings.h").is_file()
    assert not (sketch.parent / "esp32_wifi_and_mqtt_settings.h").exists()

    kit_counts = {}
    for filename, sources in KIT_SOURCES.items():
        with zipfile.ZipFile(
            FRONTEND / "downloadable_hardware_kits_and_guides" / filename
        ) as archive:
            assert archive.testzip() is None, filename
            expected_names = set(sources)
            if filename == "mqtt_sqlite_recorder_and_labview_adapter_starter_kit.zip":
                expected_names.add("mqtt_recorder_starter_kit_quick_start.md")
            assert set(archive.namelist()) == expected_names, filename
            assert len(archive.namelist()) == len(expected_names), filename
            for name in archive.namelist():
                assert (
                    not Path(name).is_absolute() and ".." not in Path(name).parts
                ), name
                assert Path(name).name != "esp32_wifi_and_mqtt_settings.h", name
                expected = (
                    EDGE_KIT_README.encode("utf-8")
                    if name == "mqtt_recorder_starter_kit_quick_start.md"
                    else (ROOT / name).read_bytes()
                )
                assert archive.read(name) == expected, (filename, name)
            kit_counts[filename] = len(expected_names)
    build(check=True)

    ignored = (ROOT / ".gitignore").read_text()
    assert (
        "esp32_telemetry_firmware/publish_esp32_robot_telemetry/esp32_wifi_and_mqtt_settings.h"
        in ignored
    )
    assert (
        "backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_broker_private_settings.json"
        in ignored
    )
    assert ".streamlit/secrets.toml" in ignored
    assert not [
        p
        for p in FRONTEND.rglob("*")
        if p.is_file() and p.suffix in {".py", ".ino", ".h"}
    ]
    assert not list((ROOT / "backend_streamlit_and_telemetry").rglob("*.js"))
    assert not (ROOT / "digital_twin_application").exists()
    assert not (ROOT / "automated_tests").exists()
    for expected in [
        "frontend_warehouse_dashboard/index.html",
        "backend_streamlit_and_telemetry/streamlit_dashboard_host.py",
        "streamlit_app.py",
        "requirements.txt",
    ]:
        assert (ROOT / expected).is_file(), expected

    catalog = (
        ROOT / "project_documentation/all_repository_file_purposes.md"
    ).read_text()
    for path in files:
        assert f"`{path.relative_to(ROOT).as_posix()}`" in catalog, path

    for previous_folder in [
        "frontend",
        "backend",
        "firmware",
        "tests",
        "docs",
        "tools",
    ]:
        assert not (ROOT / previous_folder).exists(), previous_folder

    assert not errors, "Broken local references:\n" + "\n".join(errors)
    print(
        f"PASS: {checked} local references; browser imports and document-relative workers; unique HTML IDs; "
        f"frontend_warehouse_dashboard/backend_streamlit_and_telemetry/esp32_telemetry_firmware boundaries; current file-purpose catalog coverage; "
        f"kit source matches {kit_counts}; private settings excluded; Streamlit entrypoint retained."
    )


if __name__ == "__main__":
    check()
