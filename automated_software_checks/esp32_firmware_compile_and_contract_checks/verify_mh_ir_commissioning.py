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

        multisensor_executable = Path(temporary) / 'multisensor_check'
        subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic',
            '-I', str(SKETCH), str(Path(__file__).with_name('check_multisensor_observations.cpp')),
            '-o', str(multisensor_executable)], check=True)
        rows = subprocess.run([str(multisensor_executable)], check=True, capture_output=True, text=True)
        measured, invalid, stale = [json.loads(line) for line in rows.stdout.splitlines()]
        assert measured['gyro_available'] and measured['battery_available']
        assert measured['imu_who_am_i'] == 0x70 and measured['accel_g'] == [.1,-.2,1]
        assert abs(measured['gyro_z_rad_s']-3.141592654) < 1e-9
        assert measured['battery_current_a'] == .6 and measured['battery_voltage_v'] == 7.4
        assert measured['soc_estimate_percent'] == 90 and measured['left_rpm'] is None
        for bad in (invalid, stale):
            assert not bad['gyro_available'] and not bad['battery_available']
            assert bad['gyro_z_rad_s'] is None and bad['battery_current_a'] is None
            assert bad['soc_estimate_percent'] is None
        for value in (measured, invalid, stale):
            assert value['direction_measured'] is False and value['predictive_models_ready'] is False
            assert 'encoder_left_count' not in value
            fleet = demo_fleet()
            assert not fleet.ingest(json.dumps(value).encode(), 'robot/amr01/state', received=6)
        print('PASS: multisensor units/nulls/freshness, charge/yaw continuity, final PWM settings and model isolation.')

        if not args.native_only:
            sketch = Path(temporary) / 'AMR01_Multisensor_WiFi'
            shutil.copytree(SKETCH, sketch)
            (sketch / (SKETCH.name+'.ino')).rename(sketch / (sketch.name+'.ino'))
            # Non-secret, non-placeholder values keep the network path linked.
            # With WIFI_SSID=REPLACE the compiler may eliminate the early-return
            # branch's Wi-Fi/TLS code, hiding the real firmware's resource use.
            settings = (sketch / 'example_esp32_wifi_and_mqtt_settings.h').read_text()
            settings = settings.replace('WIFI_SSID[] = "REPLACE"', 'WIFI_SSID[] = "compile-check-network"')
            settings = settings.replace('WIFI_PASSWORD[] = "REPLACE"', 'WIFI_PASSWORD[] = "compile-check-password"')
            settings = settings.replace('MQTT_HOST[] = "YOUR_EMQX_HOSTNAME"', 'MQTT_HOST[] = "example.invalid"')
            (sketch / 'esp32_wifi_and_mqtt_settings.h').write_text(settings)
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
