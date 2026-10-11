"""Build deterministic dashboard downloads from canonical backend, firmware and docs.

Run from the repository root: python tools/build_dashboard_downloads.py
Use --check to verify existing downloads without changing any file.
"""

from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import re
import zipfile


ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / "frontend/downloads"
DOCUMENT_SOURCES = (
    "docs/digital_twin_architecture_and_validation_plan.md",
    "docs/final_system_feature_audit.md",
    "docs/esp32_wifi_and_telemetry_setup.md",
    "ownership_and_external_software_licenses.txt",
)
KIT_SOURCES = {
    "esp32_robot_telemetry_starter_kit.zip": (
        "firmware/esp32_robot_telemetry/esp32_robot_telemetry.ino",
        "firmware/esp32_robot_telemetry/robot_connection_settings.example.h",
        "docs/esp32_wifi_and_telemetry_setup.md",
        "ownership_and_external_software_licenses.txt",
    ),
    "mqtt_observation_recorder_starter_kit.zip": (
        "backend/__init__.py",
        "backend/edge/__init__.py",
        "backend/edge/mqtt_observation_recorder.py",
        "backend/edge/labview_inventory_adapter.py",
        "backend/edge/requirements.txt",
        "backend/edge/reference_warehouse_graph.example.json",
        "tests/__init__.py",
        "tests/backend/__init__.py",
        "tests/backend/test_mqtt_observation_recorder.py",
        "docs/edge_observation_recorder_setup.md",
        "docs/digital_twin_architecture_and_validation_plan.md",
        "docs/software_verification_evidence.md",
        "docs/final_system_feature_audit.md",
        "ownership_and_external_software_licenses.txt",
    ),
}
EDGE_KIT_README = """# MQTT observation recorder starter kit

Run commands from this extracted directory. Use Python 3.10 or later.

```sh
python -m pip install -r backend/edge/requirements.txt
python -m backend.edge.mqtt_observation_recorder record --database warehouse-evidence.sqlite3
python -m unittest discover -s tests/backend -p 'test_*.py' -v
```

Set MQTT_HOST and MQTT_USER first; the password is requested privately.
Read [the complete setup guide](docs/edge_observation_recorder_setup.md).
The recorder archives observations. Physical robot commands require separate integration.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
"""


def document_bytes(source: str) -> bytes:
    """Make browser-readable copies; repository-relative links open GitHub sources."""
    if Path(source).suffix != ".md":
        return (ROOT / source).read_bytes()
    text = (ROOT / source).read_text(encoding="utf-8")

    def repository_link(match: re.Match) -> str:
        target = match[2]
        if target.startswith(("#", "/", "http:", "https:", "mailto:")):
            return match[0]
        relative, marker, anchor = target.partition("#")
        destination = (ROOT / source).parent.joinpath(relative).resolve()
        if not destination.is_relative_to(ROOT):
            raise ValueError(f"Document link leaves repository: {source}: {target}")
        url = "https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/"
        url += destination.relative_to(ROOT).as_posix()
        return match[1] + url + marker + anchor + match[3]

    text = re.sub(r"(\[[^\]]+\]\()([^\s)]+)(\))", repository_link, text)
    return (f"<!-- Generated from {source}; edit the canonical document and rebuild downloads. -->\n\n" + text).encode("utf-8")


def kit_members(filename: str) -> dict[str, bytes]:
    members = {source: (ROOT / source).read_bytes() for source in KIT_SOURCES[filename]}
    if filename == "mqtt_observation_recorder_starter_kit.zip":
        members["README.md"] = EDGE_KIT_README.encode("utf-8")
    return members


def archive_bytes(filename: str) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(kit_members(filename).items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content, compresslevel=9)
    return buffer.getvalue()


def build(check: bool = False) -> None:
    generated = {Path(source).name: document_bytes(source) for source in DOCUMENT_SOURCES}
    generated.update({filename: archive_bytes(filename) for filename in KIT_SOURCES})
    if not check:
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
    for filename, content in generated.items():
        destination = DOWNLOADS / filename
        if check:
            if not destination.is_file() or destination.read_bytes() != content:
                raise SystemExit(f"Stale or missing download: {destination.relative_to(ROOT)}; rebuild downloads.")
        else:
            destination.write_bytes(content)
    print(f"PASS: {len(generated)} generated downloads {'match' if check else 'built from'} canonical sources.")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify committed downloads without writing files.")
    build(check=parser.parse_args().check)
