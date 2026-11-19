"""Add authenticated one-shot Wi-Fi control to the supplied single-file sketch.

Private connection declarations are extracted to an ignored settings header.
The original sensor implementations and local Serial command behavior are retained.
The output belongs outside the public repository when it contains real settings.
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / 'esp32_telemetry_firmware/publish_mh_ir_commissioning'


def transform(source):
    begin = source.index('// ===== PRIVATE SETTINGS =====')
    end = source.index("// User's current wiring:", begin)
    private = source[begin:end]
    s = source[:begin] + '#include "esp32_wifi_and_mqtt_settings.h"\n\n' + source[end:]
    s = s.replace('#include <PubSubClient.h>', '#include <PubSubClient.h>\n#include <mbedtls/md.h>')
    canonical = (CANONICAL / 'publish_mh_ir_commissioning.ino').read_text()
    guard = (CANONICAL / 'vision_drive_guard.h').read_text().replace('#pragma once', '')
    config = canonical[canonical.index('#ifndef AMR_VISION_DRIVE_ENABLED'):canonical.index('using amr_ir::Motion;')]
    insert = s.index('// ===== WHEEL SENSORS AND LOCAL DRIVE =====')
    s = s[:insert] + guard + '\n' + config + s[insert:]
    s = s.replace('PubSubClient mqtt(tls);', 'PubSubClient mqtt(tls);\nWiFiClientSecure visionTls;\nPubSubClient visionMqtt(visionTls);')
    # Use one output writer for local and remote commands, including zero output.
    # This avoids a stale local-stop cache leaving the last remote output enabled.
    start = s.index('void applyDrive(const amr_ir::DriveOutput& drive) {')
    end = s.index('// Only setup()', start)
    outputs = canonical[canonical.index('void applyWheelDrive(int left,int right) {'):canonical.index('// Only setup()')]
    outputs = outputs.replace('  oldLeft=left; oldRight=right;', '''  portENTER_CRITICAL(&pulseMux);
  leftPulses.directionSign=(left>0)-(left<0);
  rightPulses.directionSign=(right>0)-(right<0);
  portEXIT_CRITICAL(&pulseMux);
  oldLeft=left; oldRight=right;''')
    s = s[:start] + outputs + '\n' + s[end:]
    start = canonical.index('void visionNetworkTask(void*) {')
    end = canonical.index('void setup() {', start)
    s = s.replace('void setup() {', canonical[start:end] + 'void setup() {', 1)
    s = s.replace('No remote motor control.', 'Authenticated Wi-Fi control uses one short expiring command per approval.')
    setup_end = s.index('\n}\n\nvoid loop() {', s.index('void setup() {'))
    s = s[:setup_end] + '''
  if(visionConfigured() && xTaskCreatePinnedToCore(visionNetworkTask,"amr01-manual",12288,nullptr,1,nullptr,0)!=pdPASS)
    Serial.println("Remote receiver unavailable. Local Serial remains independent.");''' + s[setup_end:]
    marker = '  controller.expire(now);'
    s = s.replace(marker, marker + '''
  bool remoteActive;
  portENTER_CRITICAL(&visionMux);
  visionReady=pwmReady && startupReady && sensorsFresh && sensors.packV>=AMR_VISION_MIN_PACK_V && visionConfigured() && (controller.requested()==Motion::stopped || visionGuard.active);
  visionGuard.tick(now,visionReady&&visionLinked); remoteActive=visionGuard.active;
  portEXIT_CRITICAL(&visionMux);
  if(remoteActive) controller.stop();''', 1)
    s = s.replace('controller.stop(); Serial.println("STOP");', '''controller.stop();
      portENTER_CRITICAL(&visionMux); visionGuard.stop("local_stop"); remoteActive=false; portEXIT_CRITICAL(&visionMux);
      Serial.println("STOP");''')
    s = s.replace('} else if (canDrive && controller.command(command,now))', '} else if (!remoteActive && canDrive && controller.command(command,now))')
    s = s.replace('  applyDrive(drive);', '''  int remoteLeft=0,remoteRight=0;
  portENTER_CRITICAL(&visionMux); remoteActive=visionGuard.active; remoteLeft=visionGuard.left; remoteRight=visionGuard.right; portEXIT_CRITICAL(&visionMux);
  if(remoteActive) {
    controller.stop(); applyWheelDrive(remoteLeft,remoteRight);
    drive.motion=(!remoteLeft&&!remoteRight)?Motion::stopped:(remoteLeft>0?(remoteRight>0?Motion::forward:Motion::right):(remoteRight>0?Motion::left:Motion::backward));
    drive.duty=uint8_t(std::max(std::abs(remoteLeft),std::abs(remoteRight)));
  } else applyDrive(drive);''', 1)
    assert 'PubSubClient visionMqtt' in s and 'sensorsFresh && sensors.packV' in s
    assert 'static constexpr uint64_t LOCAL_COMMAND_TIMEOUT_US = 0;' in s
    assert 'signedTotal = signedTotal + directionSign;' in s
    return s, private


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    sketch, settings = transform(args.source.read_text())
    args.destination.mkdir(parents=True, exist_ok=True)
    (args.destination / (args.destination.name + '.ino')).write_text(sketch)
    (args.destination / 'esp32_wifi_and_mqtt_settings.h').write_text(settings)
    print('Created sketch and private settings header; no private values were printed.')
