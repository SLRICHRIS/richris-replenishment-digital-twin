/* AMR-01: user's final TB6612 + MH IR + IMU + INA219 wiring.
 * Local USB commands: F B L R S + - Z, Serial Monitor 115200 baud.
 * Optional commissioned vision drive: authenticated short leases; disabled by default.
 * Single-channel pulse counts stay UNSIGNED; do not feed them to signed pose.
 * Keep still at boot for gyro bias collection. Test with wheels raised.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <esp_timer.h>
#include <esp_arduino_version.h>
#include <time.h>
#include "esp32_wifi_and_mqtt_settings.h"
#include "multisensor_observations.h"
#include "vision_drive_guard.h"
#include <mbedtls/md.h>
#ifndef AMR_VISION_DRIVE_ENABLED
#define AMR_VISION_DRIVE_ENABLED 0
#define AMR_VISION_DRIVE_KEY ""
#define AMR_VISION_MQTT_USERNAME ""
#define AMR_VISION_MQTT_PASSWORD ""
#define AMR_VISION_MAX_PWM 60
#define AMR_VISION_MIN_PACK_V 6.6
#endif
static_assert(AMR_VISION_MAX_PWM > 0 && AMR_VISION_MAX_PWM <= 80,"Vision PWM cap must be 1..80");
static_assert(AMR_VISION_MIN_PACK_V >= 6.0 && AMR_VISION_MIN_PACK_V <= 7.4,"Verify 2S motor-branch cutoff");
portMUX_TYPE visionMux = portMUX_INITIALIZER_UNLOCKED;
amr_vision::Guard visionGuard;
bool visionReady=false, visionLinked=false;
int appliedLeft=0,appliedRight=0;
static const char DRIVE_TOPIC[]="robot/amr01/vision/drive";
static const char HARDWARE_TOPIC[]="robot/amr01/vision/hardware";

using amr_ir::Motion;
portMUX_TYPE pulseMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE observationMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE sensorMux = portMUX_INITIALIZER_UNLOCKED;
volatile amr_ir::PulseCounter leftPulses, rightPulses;
amr_ir::LocalController controller(LOCAL_COMMAND_TIMEOUT_US, DIRECTION_INTERLOCK_US,160,20);
amr_ir::Observation latestObservation;
amr_ir::Sensors currentSensors, latestSensors;
bool observationReady = false, pwmReady = false, startupReady = false;
bool yawResetRequested = false;
bool imuInitialized = false, batteryInitialized = false;
Adafruit_INA219 ina219(INA219_ADDRESS_VALUE);
WiFiClientSecure tls;
PubSubClient mqtt(tls);
WiFiClientSecure visionTls;
PubSubClient visionMqtt(visionTls);
char bootId[24];
static const char TOPIC[] = "robot/amr01/commissioning";
static_assert(LOCAL_COMMAND_TIMEOUT_US > DIRECTION_INTERLOCK_US,"Timeout must exceed interlock");
static_assert(LEFT_PULSES_PER_REV > 0 && RIGHT_PULSES_PER_REV > 0,"PPR must be positive");
static_assert(DISCHARGE_CURRENT_SIGN == 1.0 || DISCHARGE_CURRENT_SIGN == -1.0,"Current sign must be +1 or -1");

void ARDUINO_ISR_ATTR countLeftPulse() {
  const uint32_t now = micros();
  portENTER_CRITICAL_ISR(&pulseMux); leftPulses.edge(now, DEBOUNCE_US); portEXIT_CRITICAL_ISR(&pulseMux);
}
void ARDUINO_ISR_ATTR countRightPulse() {
  const uint32_t now = micros();
  portENTER_CRITICAL_ISR(&pulseMux); rightPulses.edge(now, DEBOUNCE_US); portEXIT_CRITICAL_ISR(&pulseMux);
}

// Arduino Cloud and desktop installations may use different ESP32 core APIs.
// Core 2 uses explicit LEDC channels; core 3 assigns channels to pins.
bool attachMotorPwm() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  const bool left = ledcAttach(PWMA,PWM_FREQ,PWM_RESOLUTION);
  const bool right = ledcAttach(PWMB,PWM_FREQ,PWM_RESOLUTION);
  return left && right;
#else
  const double left = ledcSetup(0,PWM_FREQ,PWM_RESOLUTION);
  const double right = ledcSetup(1,PWM_FREQ,PWM_RESOLUTION);
  if (!(left > 0) || !(right > 0)) return false;
  ledcAttachPin(PWMA,0);
  ledcAttachPin(PWMB,1);
  return true;
#endif
}
bool writeMotorPwm(int pin, uint32_t duty) {
  if ((pin != PWMA && pin != PWMB) || duty > 255) return false;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  return ledcWrite(pin,duty);
#else
  // This older API has no success return. Do not report this as device execution.
  ledcWrite(pin == PWMA ? 0 : 1,duty);
  return true;
#endif
}

void applyWheelDrive(int left,int right) {
  static int oldLeft=999,oldRight=999;
  if(left==oldLeft && right==oldRight) return;
  digitalWrite(STBY,LOW);
  if(pwmReady) { writeMotorPwm(PWMA,0); writeMotorPwm(PWMB,0); }
  digitalWrite(AIN1,left>0?HIGH:LOW); digitalWrite(AIN2,left<0?HIGH:LOW);
  digitalWrite(BIN1,right>0?HIGH:LOW); digitalWrite(BIN2,right<0?HIGH:LOW);
  bool ok=pwmReady;
  if(ok) ok=writeMotorPwm(PWMA,std::abs(left)) && writeMotorPwm(PWMB,std::abs(right));
  if(ok && (left||right)) digitalWrite(STBY,HIGH);
  if(!ok) { pwmReady=false; controller.stop(); left=right=0; }
  portENTER_CRITICAL(&visionMux); appliedLeft=left; appliedRight=right; portEXIT_CRITICAL(&visionMux);
  oldLeft=left; oldRight=right;
}
void applyDrive(const amr_ir::DriveOutput& d) {
  int l=0,r=0;
  if(d.motion!=Motion::stopped) {
    l=(d.motion==Motion::forward||d.motion==Motion::right)?d.duty:-d.duty;
    r=(d.motion==Motion::forward||d.motion==Motion::left)?d.duty:-d.duty;
  }
  applyWheelDrive(l,r);
}
uint64_t utcMillis() { struct timeval tv; gettimeofday(&tv,nullptr); return uint64_t(tv.tv_sec)*1000+tv.tv_usec/1000; }
bool visionConfigured() {
  if(!AMR_VISION_DRIVE_ENABLED || std::strlen(AMR_VISION_DRIVE_KEY)!=64 || !*AMR_VISION_MQTT_USERNAME || !*AMR_VISION_MQTT_PASSWORD) return false;
  for(const char* p=AMR_VISION_DRIVE_KEY;*p;++p) if(!((*p>='0'&&*p<='9')||(*p>='a'&&*p<='f'))) return false;
  return true;
}
void randomIdentity(char* s) { for(int i=0;i<4;++i) snprintf(s+i*8,9,"%08lx",static_cast<unsigned long>(esp_random())); }
bool signature(const char* body,char* output) {
  unsigned char mac[32];
  const auto* info=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if(!info || mbedtls_md_hmac(info,reinterpret_cast<const unsigned char*>(AMR_VISION_DRIVE_KEY),64,reinterpret_cast<const unsigned char*>(body),std::strlen(body),mac)!=0) return false;
  for(int i=0;i<32;++i) snprintf(output+2*i,3,"%02x",mac[i]);
  return true;
}
void visionMessage(char* topic,byte* payload,unsigned int length) {
  if(!visionConfigured() || std::strcmp(topic,DRIVE_TOPIC) || length>450 || length<100) return;
  char body[451]; std::memcpy(body,payload,length); body[length]=0;
  if(std::strlen(body)!=length) return;
  char* last=std::strrchr(body,'|'); if(!last||std::strlen(last+1)!=64) return;
  *last=0; char expected[65]; if(!signature(body,expected)) return;
  unsigned diff=0; for(int i=0;i<64;++i) diff|=unsigned(expected[i]^last[1+i]);
  if(diff) return;
  amr_vision::Command command; if(!amr_vision::parse(body,command)) return;
  const uint64_t utc=utcMillis(),mono=esp_timer_get_time();
  portENTER_CRITICAL(&visionMux);
  visionGuard.accept(command,utc,mono,visionReady&&visionLinked,AMR_VISION_MAX_PWM);
  portEXIT_CRITICAL(&visionMux);
}
void hardwareHeartbeat() {
  if(!visionConfigured()) return;
  static uint32_t sequence=0; static uint32_t last=0;
  if(uint32_t(millis()-last)<150) return; last=millis();
  amr_vision::Guard g; bool ready; int l,r;
  portENTER_CRITICAL(&visionMux); g=visionGuard; ready=visionReady&&visionLinked; l=appliedLeft; r=appliedRight; portEXIT_CRITICAL(&visionMux);
  amr_ir::Sensors sensors;
  portENTER_CRITICAL(&sensorMux); sensors=currentSensors; portEXIT_CRITICAL(&sensorMux);
  char body[400],packet[470],mac[65];
  snprintf(body,sizeof body,"H1|%s|%s|%lu|%s|%lu|%s|%d|%d|%d|%d|%llu",g.boot,g.epoch,static_cast<unsigned long>(sequence++),*g.route?g.route:"00000000000000000000000000000000",static_cast<unsigned long>(g.seq),g.state,l,r,sensors.batteryValid?int(sensors.packV*1000):0,ready?1:0,static_cast<unsigned long long>(utcMillis()));
  if(signature(body,mac)) { snprintf(packet,sizeof packet,"%s|%s",body,mac); visionMqtt.publish(HARDWARE_TOPIC,packet,false); }
}

// Only setup() and the sensor task use Wire/INA219; network and motor loops do not.
bool readRegisters(uint8_t address, uint8_t reg, uint8_t* data, uint8_t count) {
  Wire.beginTransmission(address); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(address,count) != count) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) data[i] = uint8_t(Wire.read());
  return true;
}
bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDRESS); Wire.write(reg); Wire.write(value);
  return Wire.endTransmission() == 0;
}
int16_t signedWord(const uint8_t* bytes, uint8_t index) {
  return int16_t((uint16_t(bytes[index]) << 8) | bytes[index+1]);
}
bool readImu(amr_ir::Sensors& s) {
  uint8_t bytes[14];
  if (!imuInitialized || !readRegisters(MPU_ADDRESS,0x3B,bytes,sizeof bytes)) return false;
  s.ax = signedWord(bytes,0)/16384.0; s.ay = signedWord(bytes,2)/16384.0;
  s.az = signedWord(bytes,4)/16384.0;
  s.gx = signedWord(bytes,8)/131.0; s.gy = signedWord(bytes,10)/131.0;
  s.gz = signedWord(bytes,12)/131.0;
  s.imuTimeS = esp_timer_get_time()/1000000.0;
  return true;
}
void initializeSensors() {
  Wire.begin(I2C_SDA_PIN,I2C_SCL_PIN); Wire.setClock(400000); Wire.setTimeOut(20);
  uint8_t identity = 0, gyroConfig = 255, accelConfig = 255;
  const bool identified = readRegisters(MPU_ADDRESS,0x75,&identity,1);
  currentSensors.whoAmI = identity;
  Serial.printf("IMU WHO_AM_I = 0x%02X (supported: MPU6050 0x68 / MPU6500 0x70)\n",identity);
  // Both supported chips share these basic +/-2g and +/-250 deg/s registers.
  if (identified && (identity == 0x68 || identity == 0x70) && writeRegister(0x6B,0x00)) {
    delay(100);
    imuInitialized = writeRegister(0x1B,0x00) && writeRegister(0x1C,0x00) &&
      readRegisters(MPU_ADDRESS,0x1B,&gyroConfig,1) &&
      readRegisters(MPU_ADDRESS,0x1C,&accelConfig,1) && gyroConfig == 0 && accelConfig == 0;
  }
  batteryInitialized = ina219.begin(&Wire);
  if (batteryInitialized) {
    ina219.setCalibration_32V_2A();  // Adafruit standard 0.1-ohm shunt profile.
    batteryInitialized = ina219.success();
  }
  Serial.println(batteryInitialized ? "INA219 initialized (standard 0.1-ohm shunt profile)" : "INA219 not found/configuration failed");
  if (!imuInitialized) { Serial.println("IMU identity/configuration failed. Motor control stays disabled."); return; }
  Serial.println("Keep robot STATIONARY. Collecting gyro Z bias for about 3 seconds...");
  uint64_t leftBefore, rightBefore;
  portENTER_CRITICAL(&pulseMux); leftBefore = leftPulses.total; rightBefore = rightPulses.total; portEXIT_CRITICAL(&pulseMux);
  double sum = 0; int valid = 0;
  for (int i = 0; i < 1500; ++i) {
    amr_ir::Sensors reading;
    if (readImu(reading)) { sum += reading.gz; ++valid; }
    delay(2);
  }
  bool wheelsUnchanged;
  portENTER_CRITICAL(&pulseMux); wheelsUnchanged = leftBefore == leftPulses.total && rightBefore == rightPulses.total; portEXIT_CRITICAL(&pulseMux);
  currentSensors.biasAvailable = valid >= 1350 && wheelsUnchanged;
  currentSensors.biasDps = currentSensors.biasAvailable ? sum/valid : 0;
  Serial.println(currentSensors.biasAvailable ? "Gyro bias collected. Stationary setup is an operator assumption, not independent validation." : "Bias collection failed or wheel pulses changed. Keep still and reset before driving.");
  startupReady = imuInitialized && batteryInitialized && currentSensors.biasAvailable;
}

void sensorTask(void*) {
  amr_ir::Sensors s = currentSensors;
  amr_ir::ChargeTracker charge(BATTERY_CAPACITY_MAH,INITIAL_SOC_PERCENT,BATTERY_SOC_INITIALIZATION_CONFIRMED);
  amr_ir::YawTracker yaw;
  uint64_t lastBattery = 0;
  for (;;) {
    bool reset;
    portENTER_CRITICAL(&sensorMux); reset = yawResetRequested; yawResetRequested = false; portEXIT_CRITICAL(&sensorMux);
    if (reset) yaw.reset();
    s.imuValid = readImu(s);
    if (s.imuValid && s.biasAvailable) yaw.accept(s.imuTimeS,s.gz-s.biasDps);
    else yaw.invalidate();
    s.yawValid = s.imuValid && s.biasAvailable && yaw.valid(); s.yawDeg = yaw.angleDegrees();
    const uint64_t now = uint64_t(esp_timer_get_time());
    if (now-lastBattery >= 200000) {
      lastBattery = now;
      bool valid = batteryInitialized;
      uint8_t status[2] = {0,0};
      if (valid) {
        s.busV = ina219.getBusVoltage_V(); valid = ina219.success();
        s.shuntMv = ina219.getShuntVoltage_mV(); valid = ina219.success() && valid;
        s.currentA = ina219.getCurrent_mA()/1000.0*DISCHARGE_CURRENT_SIGN;
        valid = ina219.success() && valid;
        valid = readRegisters(INA219_ADDRESS_VALUE,0x02,status,2) && valid;
      }
      s.packV = s.busV+s.shuntMv/1000.0;
      s.powerW = s.packV*s.currentA;
      s.batteryTimeS = esp_timer_get_time()/1000000.0;
      s.batteryValid = valid && !(status[1] & 1) && std::isfinite(s.packV) &&
        s.packV > 0 && s.packV <= 32.0 && std::isfinite(s.currentA) && std::isfinite(s.powerW);
      if (s.batteryValid) charge.accept(s.batteryTimeS,s.currentA); else charge.invalidate();
      s.batteryContinuous = charge.continuous(); s.chargeUsedMah = charge.usedMah();
      s.socValid = s.batteryValid && charge.socValid();
      if (s.socValid) s.socPercent = charge.percent();
    }
    portENTER_CRITICAL(&sensorMux); currentSensors = s; portEXIT_CRITICAL(&sensorMux);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// TLS/MQTT waits never operate the motor GPIOs or the I2C bus.
void networkTask(void*) {
  if (!*WIFI_SSID || strcmp(WIFI_SSID, "REPLACE") == 0 || strcmp(WIFI_PASSWORD, "REPLACE") == 0) {
    Serial.println("Enter your Wi-Fi name/password in esp32_wifi_and_mqtt_settings.h, then upload again.");
    vTaskDelete(nullptr); return;
  }
  Serial.println("Connecting to Wi-Fi. Keep the 2.4 GHz hotspot and its internet connection on.");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  tls.setCACert(BROKER_ROOT_CA);
  tls.setHandshakeTimeout(5);
  mqtt.setServer(MQTT_HOST, 8883);

  mqtt.setSocketTimeout(2);
  if (!mqtt.setBufferSize(3072)) { vTaskDelete(nullptr); return; }
  uint32_t lastAttempt = millis() - 5000, lastWifiAttempt = millis();
  uint32_t sentSequence = 0;
  bool sentAny = false, wifiWasConnected = false;
  uint32_t lastClockNotice = 0;
  for (;;) {
    const uint32_t now = millis();
    const bool wifiConnected = WiFi.status() == WL_CONNECTED;
    if (wifiConnected && !wifiWasConnected) Serial.println("Wi-Fi connected. Waiting for internet clock and EMQX.");
    if (!wifiConnected && wifiWasConnected) Serial.println("Wi-Fi disconnected. Reconnecting; local controls remain independent.");
    wifiWasConnected = wifiConnected;
    if (!wifiConnected) {
      if (uint32_t(now - lastWifiAttempt) >= 10000) {
        lastWifiAttempt = now;
        WiFi.reconnect();
      }
    } else if (time(nullptr) >= 1700000000) {
      if (!mqtt.connected() && uint32_t(now - lastAttempt) >= 5000) {
        lastAttempt = now;
        char clientId[64];
        snprintf(clientId, sizeof clientId, "amr01-ir-%s", bootId);
        if (mqtt.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD))
          Serial.println("EMQX connected: commissioning topic only");
        else Serial.println("EMQX connect failed; check private TLS/client settings");
      }
      if (mqtt.connected()) {
        mqtt.loop();

        amr_ir::Observation sample;
        amr_ir::Sensors sensors;
        bool ready;
        portENTER_CRITICAL(&observationMux);
        sample = latestObservation;
        sensors = latestSensors;
        ready = observationReady;
        portEXIT_CRITICAL(&observationMux);
        const double age = esp_timer_get_time() / 1000000.0 - sample.sampleTimeS;
        if (ready && age >= 0 && age <= 2.0 && (!sentAny || sample.seq != sentSequence)) {
          char payload[2560];
          const int length = amr_ir::encodeMultisensor(payload, sizeof payload, bootId, sample, sensors,
              PULSE_CALIBRATION_CONFIRMED, LEFT_PULSES_PER_REV, RIGHT_PULSES_PER_REV);
          if (length > 0 && mqtt.publish(TOPIC, payload, false)) {
            sentSequence = sample.seq;
            sentAny = true;
          }
        }
      }
    }
    if (wifiConnected && time(nullptr) < 1700000000 && uint32_t(now-lastClockNotice) >= 10000) {
      lastClockNotice = now;
      Serial.println("Waiting for internet time. TLS remains protected; check hotspot internet access.");
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// Independent protected client: existing publisher credentials/ACL remain unchanged.
void visionNetworkTask(void*) {
  visionTls.setCACert(BROKER_ROOT_CA); visionTls.setHandshakeTimeout(5);
  visionMqtt.setServer(MQTT_HOST,8883); visionMqtt.setSocketTimeout(2);
  visionMqtt.setCallback(visionMessage); visionMqtt.setBufferSize(1024);
  uint32_t attempt=millis()-5000;
  for(;;) {
    const bool wifi=WiFi.status()==WL_CONNECTED;
    if(!wifi || !visionMqtt.connected()) {
      portENTER_CRITICAL(&visionMux); visionLinked=false; visionGuard.stop("unavailable"); portEXIT_CRITICAL(&visionMux);
    }
    if(wifi && time(nullptr)>=1700000000) {
      if(!visionMqtt.connected() && uint32_t(millis()-attempt)>=5000) {
        attempt=millis(); char id[64]; snprintf(id,sizeof id,"amr01-vision-%s",bootId);
        if(visionMqtt.connect(id,AMR_VISION_MQTT_USERNAME,AMR_VISION_MQTT_PASSWORD)) {
          char b[33],e[33]; randomIdentity(b); randomIdentity(e);
          portENTER_CRITICAL(&visionMux); visionGuard.connection(b,e); visionLinked=false; portEXIT_CRITICAL(&visionMux);
          const bool subscribed=visionMqtt.subscribe(DRIVE_TOPIC,0);
          portENTER_CRITICAL(&visionMux); visionLinked=subscribed; portEXIT_CRITICAL(&visionMux);
        }
      }
      if(visionMqtt.connected()) { visionMqtt.loop(); hardwareHeartbeat(); }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  pinMode(STBY,OUTPUT); digitalWrite(STBY,LOW);
  for (int pin : {AIN1,AIN2,BIN1,BIN2}) { pinMode(pin,OUTPUT); digitalWrite(pin,LOW); }
  Serial.begin(115200);
  pwmReady = attachMotorPwm();
  applyDrive({Motion::stopped,0});
  pinMode(LEFT_IR_PIN,INPUT_PULLUP); pinMode(RIGHT_IR_PIN,INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(LEFT_IR_PIN),countLeftPulse,FALLING);
  attachInterrupt(digitalPinToInterrupt(RIGHT_IR_PIN),countRightPulse,FALLING);
  initializeSensors();
  snprintf(bootId,sizeof bootId,"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));
  Serial.println("AMR-01 multisensor Wi-Fi telemetry: F B L R S + - Z, Serial 115200");
  Serial.printf("Motion timeout %.2f s: repeat an attended command to continue. Optional vision control is disabled until privately commissioned.\n",LOCAL_COMMAND_TIMEOUT_US/1000000.0);
  Serial.println("Wheel counts stay unsigned. RPM and absolute battery SOC need confirmed settings.");
  if (!pwmReady) Serial.println("PWM setup failed: motors remain disabled");
  if (xTaskCreatePinnedToCore(sensorTask,"amr01-sensors",6144,nullptr,2,nullptr,0) != pdPASS) {
    startupReady = false; Serial.println("Sensor task unavailable: motors remain disabled");
  }
  if(visionConfigured() && xTaskCreatePinnedToCore(visionNetworkTask,"amr01-vision",12288,nullptr,1,nullptr,0)!=pdPASS)
    Serial.println("Vision control task unavailable; remote movement disabled");
  if (xTaskCreatePinnedToCore(networkTask,"amr01-network",16384,nullptr,1,nullptr,0) != pdPASS)
    Serial.println("Network task unavailable. Local readings/control remain independent.");
}

void loop() {
  amr_ir::Sensors sensors;
  portENTER_CRITICAL(&sensorMux); sensors = currentSensors; portEXIT_CRITICAL(&sensorMux);
  // Read the clock after the snapshot so a concurrent sensor update cannot
  // appear to come from the future and spuriously stop local driving.
  const uint64_t now = uint64_t(esp_timer_get_time());
  const double timeS = now/1000000.0;
  const bool sensorsFresh = amr_ir::finiteImu(sensors) && amr_ir::finiteBattery(sensors) &&
      amr_ir::freshAt(timeS,sensors.imuTimeS,.1) && amr_ir::freshAt(timeS,sensors.batteryTimeS,.5);
  const bool canDrive = pwmReady && startupReady && sensorsFresh;
  if (!canDrive) controller.stop();
  controller.expire(now);
  bool remoteActive;
  portENTER_CRITICAL(&visionMux);
  visionReady=canDrive && sensors.packV>=AMR_VISION_MIN_PACK_V && visionConfigured() && (controller.requested()==Motion::stopped || visionGuard.active);
  visionGuard.tick(now,visionReady&&visionLinked); remoteActive=visionGuard.active;
  portEXIT_CRITICAL(&visionMux);
  if(remoteActive) controller.stop();
  for (int n = 0; n < 32 && Serial.available() > 0; ++n) {
    const char command = char(Serial.read());
    if (command == 'Z' || command == 'z') {
      portENTER_CRITICAL(&sensorMux); yawResetRequested = true; portEXIT_CRITICAL(&sensorMux);
      Serial.println("Yaw reset requested (local relative gyro estimate)");
    } else if (command == 'S' || command == 's') {
      controller.stop();
      portENTER_CRITICAL(&visionMux); visionGuard.stop("local_stop"); remoteActive=false; portEXIT_CRITICAL(&visionMux);
      Serial.println("STOP");
    } else if (!remoteActive && canDrive && controller.command(command,now)) {
      Serial.printf("Local request: %s; configured PWM: %u\n",amr_ir::motionName(controller.requested()),unsigned(controller.configuredDuty()));
    } else if (!canDrive && strchr("FfBbLlRr+-",command)) {
      Serial.println("Drive unavailable: check sensor initialization/freshness, stationary startup and PWM.");
    }
  }
  amr_ir::DriveOutput drive = controller.output(uint64_t(esp_timer_get_time()));
  int remoteLeft=0,remoteRight=0;
  portENTER_CRITICAL(&visionMux); remoteActive=visionGuard.active; remoteLeft=visionGuard.left; remoteRight=visionGuard.right; portEXIT_CRITICAL(&visionMux);
  if(remoteActive) {
    controller.stop(); applyWheelDrive(remoteLeft,remoteRight);
    drive.motion=(!remoteLeft&&!remoteRight)?Motion::stopped:(remoteLeft>=0&&remoteRight>=0)?Motion::forward:(remoteLeft<=0&&remoteRight<=0)?Motion::backward:(remoteLeft<0)?Motion::left:Motion::right;
    drive.duty=std::max(std::abs(remoteLeft),std::abs(remoteRight));
  } else applyDrive(drive);
  if (!pwmReady) drive = {Motion::stopped,0};
  static uint64_t previousTime = 0, previousLeft = 0, previousRight = 0;
  static uint32_t sequence = 0;
  if (now-previousTime >= TELEMETRY_INTERVAL_US) {
    amr_ir::Observation sample;
    portENTER_CRITICAL(&pulseMux); sample.leftTotal = leftPulses.total; sample.rightTotal = rightPulses.total; portEXIT_CRITICAL(&pulseMux);
    sample.leftDelta = sample.leftTotal-previousLeft; sample.rightDelta = sample.rightTotal-previousRight;
    sample.sampleTimeS = now/1000000.0; sample.intervalS = (now-previousTime)/1000000.0;
    sample.requested = controller.requested(); sample.output = drive.motion; sample.duty = drive.duty; sample.seq = sequence++;
    previousTime = now; previousLeft = sample.leftTotal; previousRight = sample.rightTotal;
    portENTER_CRITICAL(&observationMux); latestObservation = sample; latestSensors = sensors; observationReady = true; portEXIT_CRITICAL(&observationMux);
    Serial.printf("Unsigned pulse totals L=%llu R=%llu\n",static_cast<unsigned long long>(sample.leftTotal),static_cast<unsigned long long>(sample.rightTotal));
    if (sensorsFresh) {
      Serial.printf("IMU: accel g [%.3f %.3f %.3f], gyro deg/s [%.3f %.3f %.3f]\n",sensors.ax,sensors.ay,sensors.az,sensors.gx,sensors.gy,sensors.gz);
      Serial.printf("Battery input %.3f V, discharge-positive %.4f A, %.3f W\n",sensors.packV,sensors.currentA,sensors.powerW);
    } else Serial.println("Sensor reading unavailable/stale. MQTT marks invalid channels as null.");
    if (sensors.yawValid) Serial.printf("Relative yaw %.2f deg\n",sensors.yawDeg);
    if (sensors.socValid) Serial.printf("Estimated battery level %.2f %%\n",sensors.socPercent);
    else Serial.println("Battery SOC unavailable: initial charge/capacity/polarity unconfirmed or a measurement gap occurred.");
    if (PULSE_CALIBRATION_CONFIRMED) Serial.printf("RPM magnitude L=%.2f R=%.2f\n",sample.leftDelta*60.0/(sample.intervalS*LEFT_PULSES_PER_REV),sample.rightDelta*60.0/(sample.intervalS*RIGHT_PULSES_PER_REV));
  }
  delay(2);
}
