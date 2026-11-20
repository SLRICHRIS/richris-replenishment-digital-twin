"""Configuration regression only. These checks do not activate physical motors."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIRMWARE = ROOT / "esp32_telemetry_firmware"


def test_vision_receiver_compiled_in_but_never_publicly_authorized():
    for path in (
        FIRMWARE / "publish_mh_ir_commissioning" / "example_esp32_wifi_and_mqtt_settings.h",
        FIRMWARE / "AMR01_Manual_WiFi" / "example_esp32_wifi_and_mqtt_settings.h",
    ):
        source = path.read_text()
        assert "#define AMR_VISION_DRIVE_ENABLED 1" in source
        assert '#define AMR_VISION_DRIVE_KEY ""' in source
        assert '#define AMR_VISION_MQTT_USERNAME ""' in source
        assert '#define AMR_VISION_MQTT_PASSWORD ""' in source
        assert "#define AMR_VISION_MIN_PACK_V 6.6" in source
        assert "#define AMR_VISION_MAX_PWM 60" in source
    code = (FIRMWARE / "publish_mh_ir_commissioning" /
            "publish_mh_ir_commissioning.ino").read_text()
    assert 'std::strlen(AMR_VISION_DRIVE_KEY)!=64' in code
    assert 'visionReady=canDrive && sensors.packV>=AMR_VISION_MIN_PACK_V' in code
    assert 'visionGuard.accept(command,utc,mono,visionReady&&visionLinked' in code
    assert 'if(!visionConfigured()) return;' in code


def test_battery_point_e_is_parking_only_and_never_claims_docking():
    code = (ROOT / "frontend_warehouse_dashboard/browser_modules/vision_routing" /
            "physical_route_execution.js").read_text()
    assert "E · Battery parking (no docking)" in code
    assert "There is no physical self-charging or docking connection" in code
    assert "the robot stops near E and does not connect to a charger" in code
