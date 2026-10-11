"""Compile both UART variants and optionally run the native controller contract."""

import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SKETCH = ROOT / "esp32_telemetry_firmware/publish_esp32_robot_telemetry"


def verify(args):
    with tempfile.TemporaryDirectory() as temporary:
        sketch = Path(temporary) / SKETCH.name
        shutil.copytree(SKETCH, sketch)
        settings = (sketch / "example_esp32_wifi_and_mqtt_settings.h").read_text()
        # Reference build pins only; this temporary header is never uploaded/committed.
        for enabled in (0, 1):
            configured = settings.replace(
                "#define ENABLE_CONTROLLER_UART 0",
                f"#define ENABLE_CONTROLLER_UART {enabled}",
            )
            configured = configured.replace(
                "#define CONTROLLER_UART_RX_PIN -1", "#define CONTROLLER_UART_RX_PIN 16"
            ).replace(
                "#define CONTROLLER_UART_TX_PIN -1", "#define CONTROLLER_UART_TX_PIN 17"
            )
            (sketch / "esp32_wifi_and_mqtt_settings.h").write_text(configured)
            command = [args.arduino_cli, "compile", "--fqbn", args.board, str(sketch)]
            if args.config_file:
                command += ["--config-file", args.config_file]
            subprocess.run(command, check=True)
            print(f"PASS: real Arduino compilation, UART enabled={enabled}", flush=True)
        if args.json_include:
            executable = Path(temporary) / "controller_uart_contract"
            source = Path(__file__).with_name(
                "check_onboard_controller_uart_contract.cpp"
            )
            subprocess.run(
                [
                    "g++",
                    "-std=c++17",
                    "-Wall",
                    "-Werror",
                    "-I",
                    str(SKETCH),
                    "-I",
                    args.json_include,
                    str(source),
                    "-o",
                    str(executable),
                ],
                check=True,
            )
            subprocess.run([str(executable)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arduino-cli", default="arduino-cli")
    parser.add_argument("--config-file")
    parser.add_argument("--board", default="esp32:esp32:esp32")
    parser.add_argument(
        "--json-include",
        help="ArduinoJson/src directory for native firmware behavior test",
    )
    verify(parser.parse_args())
