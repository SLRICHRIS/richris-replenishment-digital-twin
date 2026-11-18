"""Build or verify the five-file ZIP imported directly by Arduino Cloud Editor.

The archive deliberately uses public placeholder settings. Runtime credentials,
operator access codes and database receipts must never enter this download.
"""
import argparse
import io
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "esp32_telemetry_firmware/publish_mh_ir_commissioning"
DESTINATION = ROOT / "esp32_telemetry_firmware/downloads/AMR01_Arduino_Cloud_Import.zip"
PREFIX = "AMR01_Multisensor_WiFi/"
SOURCES = (
    ("publish_mh_ir_commissioning.ino", "AMR01_Multisensor_WiFi.ino"),
    ("mh_ir_controller.h", "mh_ir_controller.h"),
    ("multisensor_observations.h", "multisensor_observations.h"),
    ("vision_drive_guard.h", "vision_drive_guard.h"),
    ("example_esp32_wifi_and_mqtt_settings.h", "esp32_wifi_and_mqtt_settings.h"),
)


def build():
    settings = (SOURCE / SOURCES[-1][0]).read_text()
    if 'MQTT_PASSWORD[] = "REPLACE"' not in settings or 'WIFI_PASSWORD[] = "REPLACE"' not in settings:
        raise ValueError("Import ZIP requires the public placeholder configuration")
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", compression=zipfile.ZIP_STORED) as archive:
        for source, target in SOURCES:
            info = zipfile.ZipInfo(PREFIX + target, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, (SOURCE / source).read_bytes())
    return result.getvalue()


def verify(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        expected = [PREFIX + target for _, target in SOURCES]
        if archive.namelist() != expected or archive.testzip() is not None:
            raise ValueError("Import archive structure or CRC is invalid")
        for source, target in SOURCES:
            if archive.read(PREFIX + target) != (SOURCE / source).read_bytes():
                raise ValueError("Import archive is out of date: " + target)
    if data != build():
        raise ValueError("Import archive is not the reproducible canonical build")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        data = DESTINATION.read_bytes()
    else:
        data = build()
        DESTINATION.parent.mkdir(parents=True, exist_ok=True)
        DESTINATION.write_bytes(data)
    verify(data)
    print("PASS: Arduino Cloud import ZIP has the current sketch and four headers; settings are placeholders.")
