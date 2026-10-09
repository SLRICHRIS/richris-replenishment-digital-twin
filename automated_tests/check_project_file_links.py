"""Check local file references after reorganizing the project.

Run from the repository root:
    python automated_tests/check_project_file_links.py
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "digital_twin_application"


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in {"src", "href"} and value:
                self.references.append(value)


def check():
    checked = 0
    errors = []

    def inspect(owner, reference):
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
        destination = (owner.parent / relative).resolve()
        checked += 1
        if not destination.is_relative_to(ROOT) or not destination.exists():
            errors.append(f"{owner.relative_to(ROOT)} -> {reference}")

    files = [
        path for path in ROOT.rglob("*")
        if path.is_file()
        and not {"node_modules", "__pycache__", ".git", ".pytest_cache"}.intersection(path.parts)
    ]
    for path in files:
        if path.suffix not in {".html", ".js", ".css", ".md"}:
            continue
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".html":
            page = PageReferences()
            page.feed(text)
            for reference in page.references:
                inspect(path, reference)
        elif path.suffix == ".css":
            for match in re.finditer(r"""url\(\s*['"]?([^'")]+)""", text):
                inspect(path, match.group(1).strip())
        elif path.suffix == ".js":
            expressions = [
                r"""\bfrom\s*['"]([^'"]+)['"]""",
                r"""\bimport\s*\(\s*['"]([^'"]+)['"]""",
                r"""\bnew\s+Worker\s*\(\s*['"]([^'"]+)['"]""",
            ]
            for expression in expressions:
                for match in re.finditer(expression, text):
                    reference = match.group(1)
                    if reference.startswith(".") or (expression == expressions[-1] and reference.endswith(".js")):
                        inspect(path, reference)
        else:
            for match in re.finditer(r"\[[^\]]+\]\(([^)\s]+)\)", text):
                inspect(path, match.group(1))

    firmware = APP / "esp32_robot_firmware"
    sketch = firmware / "ESP32_Robot_Telemetry/ESP32_Robot_Telemetry.ino"
    assert sketch.stem == sketch.parent.name
    assert '#include "robot_connection_settings.h"' in sketch.read_text()
    assert (sketch.parent / "robot_connection_settings.example.h").is_file()
    assert not (sketch.parent / "robot_connection_settings.h").exists()

    with zipfile.ZipFile(firmware / "esp32_robot_telemetry_starter_kit.zip") as archive:
        assert archive.testzip() is None
        entries = archive.namelist()
        assert len(entries) == 4, entries
        for name in entries:
            assert not Path(name).is_absolute() and ".." not in Path(name).parts
            assert Path(name).name != "robot_connection_settings.h"
            expected = firmware / name
            if name == "ownership_and_external_software_licenses.txt":
                expected = APP / name
            assert expected.is_file(), name
            assert archive.read(name) == expected.read_bytes(), name

    ignored = (ROOT / ".gitignore").read_text()
    private_settings = sketch.parent.relative_to(ROOT).as_posix() + "/robot_connection_settings.h"
    assert private_settings in ignored
    assert (APP / "index.html").is_file()
    assert (ROOT / "streamlit_app.py").is_file()
    assert (ROOT / "requirements.txt").is_file()
    assert not errors, "Broken local references:\n" + "\n".join(errors)
    print(f"PASS: {checked} local application/guide references; Arduino sketch naming; "
          f"{len(entries)} firmware-download files match their sources; "
          "configured credentials excluded; Streamlit entry files retained.")


if __name__ == "__main__":
    check()

