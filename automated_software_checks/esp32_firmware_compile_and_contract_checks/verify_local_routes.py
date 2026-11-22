"""Native LAN route protocol/guard checks; no network access or motor actuation.

Requires g++ and OpenSSL development headers. This does not replace an Arduino
build or attended hardware commissioning of sensor timing and wheel outputs.
"""
from pathlib import Path
import argparse
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SKETCH = ROOT / 'esp32_telemetry_firmware/AMR01_Local_Routes'
sys.path.insert(0, str(ROOT))


def verify(arduino_cli=None, config_file=None):
    from backend_streamlit_and_telemetry.vision_control.protocol import drive, hardware, signed, verified
    from backend_streamlit_and_telemetry.vision_control.local_transport import DeviceHTTPTransport
    key = '0123456789abcdef' * 4
    boot, epoch, route = 'a' * 32, 'b' * 32, 'c' * 32
    now = 1700000000000
    command = drive(boot, epoch, route, 1, 'arm', 0, 0, now, key, max_pwm=60)
    with tempfile.TemporaryDirectory() as temporary:
        executable = Path(temporary) / 'local_route_protocol_check'
        subprocess.run([
            'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic',
            '-I', str(SKETCH), str(Path(__file__).with_name('check_local_route_protocol.cpp')),
            '-lcrypto', '-o', str(executable),
        ], check=True)
        run = subprocess.run([str(executable)], input=command + '\n', text=True,
                             capture_output=True, check=True)
        # Run real Python transport output through the real C++ receiver guard.
        # The signed sample is 20 ms old in the receiver's time domain. A
        # laptop may lead by 220 ms or lag by 80 ms and still accept this H1.
        # No sockets, physical device or motor command is involved.
        class Reply:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): return self.body[:size]

        class Receiver:
            command = None
            def open(self, request, timeout):
                if request.data is not None:
                    self.command = request.data
                    return Reply(b'{"ok":true}')
                return Reply(signed(('H1', boot, epoch, 1, '0'*32, 0, 'idle',
                                     0, 0, 7400, 1, now-20), key).encode())

        for clock_ahead_ms in (-80, 220):
            receiver = Receiver()
            transport = DeviceHTTPTransport(key, opener=receiver, clock=lambda: now+clock_ahead_ms)
            observed = transport.poll()
            transport.send(observed, route, 1, 'arm', 0, 0, now+clock_ahead_ms)
            fields = verified(receiver.command, key, 10)
            assert int(fields[8]) <= now and int(fields[9]) <= now+500
            aligned = subprocess.run([str(executable)], input=receiver.command.decode()+'\n',
                                     text=True, capture_output=True, check=True)
            assert hardware(aligned.stdout.splitlines()[0], key, now, max_pwm=60)['state'] == 'armed'
        print('PASS: Python HTTP transport commands accepted by production C++ guard with '
              'opposing clock offsets; unchanged freshness and bounded expiry.')
        # Compile the real receiver and its original local-controller/sensor
        # classes against deterministic hardware substitutes. Fake HMAC APIs
        # call real OpenSSL, and no substitute can open a network/GPIO device.
        app = (SKETCH / 'amr_wireless_app.h').read_text()
        behaviors = app.split('// ===== WHEEL SENSORS AND LOCAL DRIVE =====', 1)[1].split('// ===== ESP32 APPLICATION =====', 1)[0]
        (Path(temporary) / 'local_route_test_behaviors.h').write_text(behaviors)
        wifi = app.split('// ===== WI-FI CONNECTION RECOVERY =====', 1)[1].split('// ===== END WI-FI CONNECTION RECOVERY =====', 1)[0]
        (Path(temporary) / 'local_wifi_test_behaviors.h').write_text(wifi)
        stub = Path(temporary) / 'mbedtls'
        stub.mkdir()
        (stub / 'md.h').write_text('''#pragma once
#include <openssl/hmac.h>
#define MBEDTLS_MD_SHA256 1
inline const EVP_MD* mbedtls_md_info_from_type(int) { return EVP_sha256(); }
inline int mbedtls_md_hmac(const EVP_MD* info,const unsigned char* key,size_t keySize,
    const unsigned char* data,size_t size,unsigned char* output) {
  unsigned length=0;
  return HMAC(info,key,int(keySize),data,size,output,&length) && length==32 ? 0 : 1;
}
''')
        runtime = Path(temporary) / 'local_route_runtime_check'
        subprocess.run([
            'g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic',
            '-I', temporary, '-I', str(SKETCH),
            str(Path(__file__).with_name('check_local_route_runtime.cpp')),
            '-lcrypto', '-o', str(runtime),
        ], check=True)
        subprocess.run([str(runtime)], check=True)
        if arduino_cli:
            sketch = Path(temporary) / SKETCH.name
            shutil.copytree(SKETCH, sketch, ignore=shutil.ignore_patterns('private_amr_settings.h'))
            settings = (sketch / 'example_private_amr_settings.h').read_text()
            settings = settings.replace('"YOUR_WIFI_SSID"', '"compile-check-only"')
            settings = settings.replace('"YOUR_WIFI_PASSWORD"', '"compile-check-only"')
            settings = settings.replace('MQTT_HOST[] = ""', 'MQTT_HOST[] = "example.invalid"')
            settings = settings.replace('MQTT_USERNAME[] = ""', 'MQTT_USERNAME[] = "compile-check-only"')
            settings = settings.replace('MQTT_PASSWORD[] = ""', 'MQTT_PASSWORD[] = "compile-check-only"')
            settings = settings.replace('#define AMR_ROUTE_KEY ""', '#define AMR_ROUTE_KEY "'+'a'*64+'"')
            (sketch / 'private_amr_settings.h').write_text(settings)
            build = [arduino_cli, 'compile', '--fqbn', 'esp32:esp32:esp32', str(sketch)]
            if config_file:
                build += ['--config-file', config_file]
            subprocess.run(build, check=True)
            print('PASS: actual Local Routes ESP32 build with test-only network and signing settings.')
    packets = [hardware(line, key, now + 100, max_pwm=200) for line in run.stdout.splitlines()]
    assert len(packets) == 2
    first, second = packets
    assert first['protocol'] == 'H1' and first['state'] == 'armed'
    assert first['boot_id'] == boot and first['epoch_id'] == epoch and first['route_id'] == route
    assert first['ready'] and first['left_duty'] == first['right_duty'] == 0
    assert first['command_seq'] == 1 and first['age_ms'] == 100
    assert second['protocol'] == 'H1' and second['state'] == 'moving'
    assert second['ready'] and second['left_duty'] == 200 and second['right_duty'] == -200
    assert second['seq'] == second['command_seq'] == 2 and second['age_ms'] == 0
    assert second['battery_voltage_v'] == 7.39
    print('PASS: production V1/H1 HMAC compatibility, malformed/NUL/auth rejection, '
          '500 ms deadline, stale/replay/boot/epoch checks, configured PWM caps, read-only '
          'heartbeat, route cancellation, readiness loss and reversal interlock.')

    # Regression checks on the transport integration complement the executable
    # parser/guard tests. They do not simulate Arduino scheduling or peripherals.
    app = (SKETCH / 'amr_wireless_app.h').read_text()
    receiver = (SKETCH / 'amr_route_control.h').read_text()
    assert 'rxMqtt' not in receiver and 'receiverTask' not in receiver
    assert '.subscribe(' not in receiver and '.setCallback(' not in receiver
    assert 'webServer.on("/api/route/command", HTTP_POST, amr_route::handleCommand)' in app
    assert 'webServer.on("/api/route/hardware", HTTP_GET, amr_route::handleHardware)' in app
    network = app.split('void networkTask(void*) {', 1)[1].split('void setup()', 1)[0]
    assert network.index('configTime(') < network.index('if (mqttConfigured)')
    assert network.index('WiFi.mode(WIFI_STA)') < network.index('WiFi.setSleep(false)') < network.index('WiFi.begin(')
    assert network.index('WiFi.onEvent(amr_wifi::onEvent)') < network.index('WiFi.begin(')
    assert 'WiFi.setSleep(true)' not in app
    assert 'amr_wifi::service(webServer);' in app.split('void loop() {', 1)[1]
    assert 'webServerStarted' not in app
    readiness = receiver.split('static bool networkReady() {', 1)[1].split('}', 1)[0]
    assert 'WiFi.status() == WL_CONNECTED' in readiness and 'utcMs()' in readiness
    assert 'mqtt' not in readiness.lower()
    assert 'guard.stop("local_stop")' in receiver
    assert 'AMR_ROUTE_MAX_PWM <= 200' in receiver
    assert 'Cache-Control' in receiver and 'no-store' in receiver
    print('PASS: LAN route endpoints, awake Wi-Fi startup, MQTT actuator removal, independent clock setup '
          'and preserved local stop integration checks.')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arduino-cli', help='Also compile with this Arduino CLI executable')
    parser.add_argument('--config-file')
    args=parser.parse_args()
    verify(args.arduino_cli,args.config_file)
