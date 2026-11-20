#pragma once
// Copy to PRIVATE esp32_wifi_and_mqtt_settings.h; this filename is git-ignored.
static const char WIFI_SSID[] = "REPLACE";
static const char WIFI_PASSWORD[] = "REPLACE";
static const char MQTT_HOST[] = "YOUR_EMQX_HOSTNAME";
static const char MQTT_USERNAME[] = "publisher-amr01";
static const char MQTT_PASSWORD[] = "REPLACE";
static const char BROKER_ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_BROKER_TRUSTED_ROOT_CA
-----END CERTIFICATE-----
)PEM";

// User's current wiring: do not substitute the older quadrature sketch's pins.
static constexpr int PWMA = 25, AIN1 = 26, AIN2 = 27;
static constexpr int PWMB = 14, BIN1 = 32, BIN2 = 33, STBY = 13;
static constexpr int LEFT_IR_PIN = 18, RIGHT_IR_PIN = 19;
static constexpr uint32_t DEBOUNCE_US = 2000;
static constexpr uint32_t PWM_FREQ = 1000;
static constexpr uint8_t PWM_RESOLUTION = 8;
static constexpr uint64_t LOCAL_COMMAND_TIMEOUT_US = 3000000;
static constexpr uint64_t DIRECTION_INTERLOCK_US = 150000;

// Count actual FALLING edges over several wheel revolutions before confirming.
// These 1.0 values reproduce the supplied code's assumption, not a measurement.
static constexpr double LEFT_PULSES_PER_REV = 1.0;
static constexpr double RIGHT_PULSES_PER_REV = 1.0;
static constexpr bool PULSE_CALIBRATION_CONFIRMED = false;

// Final multisensor wiring: shared I2C bus, no motor pin changes.
static constexpr int I2C_SDA_PIN = 21, I2C_SCL_PIN = 22;
static constexpr uint8_t MPU_ADDRESS = 0x68, INA219_ADDRESS_VALUE = 0x40;
static constexpr uint32_t TELEMETRY_INTERVAL_US = 500000;
// Assumptions from the supplied sketch. Confirm capacity, starting charge and
// discharge-positive current polarity before enabling an absolute SOC estimate.
static constexpr double BATTERY_CAPACITY_MAH = 2200.0;
static constexpr double INITIAL_SOC_PERCENT = 100.0;
static constexpr double DISCHARGE_CURRENT_SIGN = 1.0;
static constexpr bool BATTERY_SOC_INITIALIZATION_CONFIRMED = false;

// Enable ONLY after the attended camera/motor commissioning in the route guide.
// Generate a NEW private 64-character lowercase hex key; never reuse HTTP auth.
// Protected Wi-Fi drive feature is compiled in for the user's motor test.
// EMPTY drive key / receiver credentials still fail visionConfigured(), and
// invalid/expired signed commands never operate motors. Complete and flash
// PRIVATE settings on the physical ESP32 before expecting any response.
#define AMR_VISION_DRIVE_ENABLED 1
#define AMR_VISION_DRIVE_KEY ""
#define AMR_VISION_MQTT_USERNAME ""
#define AMR_VISION_MQTT_PASSWORD ""
#define AMR_VISION_MAX_PWM 60
#define AMR_VISION_MIN_PACK_V 6.6
