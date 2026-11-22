"""Build deterministic dashboard downloads from canonical backend_streamlit_and_telemetry, esp32_telemetry_firmware and project_documentation.

Run from the repository root: python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py
Use --check to verify existing downloads without changing any file.
"""

from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / "frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides"
DOCUMENT_SOURCES = (
    "project_documentation/digital_twin_architecture_and_validation_plan.md",
    "project_documentation/digital_twin_feature_alignment_audit.md",
    "project_documentation/esp32_wifi_and_telemetry_setup.md",
    "project_documentation/operator_override_channel_and_hardware_commissioning.md",
    "project_ownership_and_external_software_licenses.txt",
)
KIT_SOURCES = {
    "AMR01_Local_Routes.zip": tuple(
        "esp32_telemetry_firmware/AMR01_Local_Routes/" + name
        for name in ("AMR01_Local_Routes.ino", "amr_wireless_app.h", "amr_route_control.h", "amr_mqtt_transport.h", "route_http_protocol.h", "vision_drive_guard.h", "example_private_amr_settings.h")
    ) + ("project_documentation/direct_wifi_aruco_routes.md", "project_documentation/local_station_missions.md"),
    "esp32_robot_telemetry_starter_kit.zip": (
        "esp32_telemetry_firmware/publish_esp32_robot_telemetry/publish_esp32_robot_telemetry.ino",
        "esp32_telemetry_firmware/publish_esp32_robot_telemetry/robot_telemetry_packet_serializer.h",
        "esp32_telemetry_firmware/publish_esp32_robot_telemetry/onboard_controller_sensor_and_override_bridge.h",
        "esp32_telemetry_firmware/publish_esp32_robot_telemetry/example_esp32_wifi_and_mqtt_settings.h",
        "project_documentation/esp32_wifi_and_telemetry_setup.md",
        "project_documentation/operator_override_channel_and_hardware_commissioning.md",
        "project_ownership_and_external_software_licenses.txt",
    ),
    "mqtt_sqlite_recorder_and_labview_adapter_starter_kit.zip": (
        "backend_streamlit_and_telemetry/__init__.py",
        "backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/__init__.py",
        "backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_telemetry_recorder_and_inventory_publisher.py",
        "backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/labview_inventory_observation_adapter.py",
        "backend_streamlit_and_telemetry/operator_override_control_channel/__init__.py",
        "backend_streamlit_and_telemetry/operator_override_control_channel/operator_override_command_coordinator.py",
        "backend_streamlit_and_telemetry/operator_override_control_channel/labview_operator_override_http_adapter.py",
        "automated_software_checks/python_telemetry_service_checks/test_operator_override_command_lifecycle.py",
        "project_documentation/operator_override_channel_and_hardware_commissioning.md",
        "backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt",
        "backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/example_warehouse_route_graph_for_calibration.json",
        "automated_software_checks/__init__.py",
        "automated_software_checks/python_telemetry_service_checks/__init__.py",
        "automated_software_checks/python_telemetry_service_checks/test_mqtt_recorder_and_labview_inventory_adapter.py",
        "project_documentation/mqtt_sqlite_recorder_and_labview_adapter_setup.md",
        "project_documentation/digital_twin_architecture_and_validation_plan.md",
        "project_documentation/routing_and_robot_model_software_verification.md",
        "project_documentation/digital_twin_feature_alignment_audit.md",
        "project_ownership_and_external_software_licenses.txt",
    ),
}
EDGE_KIT_README = """# MQTT observation recorder starter kit

Run commands from this extracted directory. Use Python 3.10 or later.

```sh
python -m pip install -r backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt
python -m backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.mqtt_telemetry_recorder_and_inventory_publisher record --database warehouse-evidence.sqlite3
python -m unittest discover -s automated_software_checks/python_telemetry_service_checks -p 'test_*.py' -v
```

Set MQTT_HOST and MQTT_USER first; the password is requested privately.
Read [the complete setup guide](project_documentation/mqtt_sqlite_recorder_and_labview_adapter_setup.md).
The recorder archives observations. The separate Coordinator and controller bridge are described in project_documentation/operator_override_channel_and_hardware_commissioning.md.

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
        url = (
            "https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/"
        )
        url += destination.relative_to(ROOT).as_posix()
        return match[1] + url + marker + anchor + match[3]

    text = re.sub(r"(\[[^\]]+\]\()([^\s)]+)(\))", repository_link, text)
    return (
        f"<!-- Generated from {source}; edit the canonical document and rebuild downloads. -->\n\n"
        + text
    ).encode("utf-8")


def kit_members(filename: str) -> dict[str, bytes]:
    members = {source: (ROOT / source).read_bytes() for source in KIT_SOURCES[filename]}
    if filename == "mqtt_sqlite_recorder_and_labview_adapter_starter_kit.zip":
        members["mqtt_recorder_starter_kit_quick_start.md"] = EDGE_KIT_README.encode(
            "utf-8"
        )
    return members


def archive_bytes(filename: str) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(
        buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for name, content in sorted(kit_members(filename).items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content, compresslevel=9)
    return buffer.getvalue()


def build(check: bool = False) -> None:
    generated = {
        Path(source).name: document_bytes(source) for source in DOCUMENT_SOURCES
    }
    generated.update({filename: archive_bytes(filename) for filename in KIT_SOURCES})
    if not check:
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
    for filename, content in generated.items():
        destination = DOWNLOADS / filename
        if check:
            if not destination.is_file() or destination.read_bytes() != content:
                raise SystemExit(
                    f"Stale or missing download: {destination.relative_to(ROOT)}; rebuild downloads."
                )
        else:
            destination.write_bytes(content)
    print(
        f"PASS: {len(generated)} generated downloads {'match' if check else 'built from'} canonical sources."
    )


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify committed downloads without writing files.",
    )
    build(check=parser.parse_args().check)
