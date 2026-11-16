"""Check actual MH IR controller behavior, wire JSON and optional Arduino build."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SKETCH = ROOT / 'esp32_telemetry_firmware/publish_mh_ir_commissioning'
sys.path.insert(0, str(ROOT))


def verify(args):
    with tempfile.TemporaryDirectory() as temporary:
        executable = Path(temporary) / 'mh_ir_controller_check'
        subprocess.run([
            'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic',
            '-I', str(SKETCH), str(Path(__file__).with_name('check_mh_ir_controller.cpp')),
            '-o', str(executable),
        ], check=True)
        result = subprocess.run([str(executable)], check=True, capture_output=True, text=True)
        packet = json.loads(result.stdout)
        assert packet['schema_version'] == 1
        assert packet['message_type'] == 'mh_ir_commissioning'
        assert packet['left_pulses_total'] == 26 and packet['right_pulses_total'] == 44
        assert packet['left_pulse_hz'] == 3 and packet['right_pulse_hz'] == 2
        assert packet['left_rpm'] == 90 and packet['right_rpm'] == 120
        assert packet['commanded_motion'] == 'backward'
        assert packet['direction_measured'] is False
        assert packet['gyro_available'] is False and packet['battery_available'] is False
        assert packet['predictive_models_ready'] is False

        from backend_streamlit_and_telemetry.predictive_twin.demo import demo_fleet
        encoded = json.dumps(packet).encode()
        # Even accidental routing to /state must not admit unsigned observations.
        for topic in ('robot/amr01/commissioning', 'robot/amr01/state'):
            fleet = demo_fleet()
            before = fleet.snapshots(now=6)['amr01']
            outcome = fleet.ingest(encoded, topic, received=6)
            assert outcome is False
            after = fleet.snapshots(now=6)['amr01']
            for key in ('pose', 'soc', 'energy_wh'):
                assert after[key] == before[key]
            if topic.endswith('/state'):
                assert after['quality'] != 'OK'
                assert after['raw'] is None and after['continuity_lost']
            else:
                assert after == before
        print('PASS: MH pulse debounce/wrap, cumulative unsigned counts, local command timeout, '
              'direction interlock, stopped-speed behavior, native JSON/RPM and twin-source isolation.')

        if not args.native_only:
            sketch = Path(temporary) / SKETCH.name
            shutil.copytree(SKETCH, sketch)
            shutil.copyfile(sketch / 'example_esp32_wifi_and_mqtt_settings.h',
                            sketch / 'esp32_wifi_and_mqtt_settings.h')
            command = [args.arduino_cli, 'compile', '--fqbn', args.board, str(sketch)]
            if args.config_file:
                command += ['--config-file', args.config_file]
            subprocess.run(command, check=True)
            print('PASS: actual Arduino build of MH IR local control and commissioning publisher.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-only', action='store_true')
    parser.add_argument('--arduino-cli', default='arduino-cli')
    parser.add_argument('--config-file')
    parser.add_argument('--board', default='esp32:esp32:esp32')
    verify(parser.parse_args())
