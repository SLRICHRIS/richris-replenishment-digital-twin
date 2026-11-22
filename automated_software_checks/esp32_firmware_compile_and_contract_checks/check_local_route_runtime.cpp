// Compile the production receiver with deterministic hardware/task substitutes.
// No network sockets, threads, serial ports or real GPIOs are opened by this test.
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <sys/time.h>
#include "local_route_test_behaviors.h"

using amr_ir::Motion;
using String = std::string;
using portMUX_TYPE = int;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(x) (void)(x)
#define portEXIT_CRITICAL(x) (void)(x)
#define AMR_ROUTE_KEY "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
#define AMR_CONTROL_KEY "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
#define AMR_ROUTE_MAX_PWM 60
#define AMR_ROUTE_MIN_PACK_V 6.6
constexpr int HIGH=1, LOW=0, WL_CONNECTED=3, pdPASS=1;
constexpr int PWMA=25, PWMB=14, AIN1=26, AIN2=27, BIN1=32, BIN2=33, STBY=13;
constexpr uint64_t DIRECTION_INTERLOCK_US=150000;
uint64_t nowUs=1000000, utcBase=1700000000000ULL;
int64_t esp_timer_get_time() { return int64_t(nowUs); }
uint32_t millis() { return uint32_t(nowUs/1000); }
uint32_t esp_random() { static uint32_t n=100; return ++n; }
void vTaskDelay(int) {}
int xTaskCreatePinnedToCore(void (*)(void*),const char*,int,void*,int,void*,int) { return pdPASS; }
int fakeGettimeofday(timeval* tv,void*) {
  const uint64_t utc=utcBase+nowUs/1000;
  tv->tv_sec=utc/1000; tv->tv_usec=(utc%1000)*1000; return 0;
}
#define gettimeofday fakeGettimeofday
struct FakeWiFi { int connected=WL_CONNECTED; int status() { return connected; } } WiFi;
std::map<int,int> pins, duties;
void digitalWrite(int pin,int value) { pins[pin]=value; }
bool writeMotorPwm(int pin,uint32_t duty) { duties[pin]=int(duty); return true; }
struct FakeSerial {
  void println(const char*) {}
  template <typename... T> void printf(const char*,T...) {}
} Serial;
struct FakeWebServer {
  std::string input,body,type,cache;
  bool hasBody=true;
  int code=0;
  bool hasArg(const char*) { return hasBody; }
  String arg(const char*) { return input; }
  void sendHeader(const char*,const char* value) { cache=value; }
  void send(int status,const char* mime,const char* value) { code=status;type=mime;body=value; }
} webServer;
constexpr int MQTT_CONNECTION_TIMEOUT=-4, MQTT_CONNECT_FAILED=-2, MQTT_MAX_HEADER_SIZE=5;
struct PubSubClient {
  int state() { return MQTT_CONNECT_FAILED; }
  size_t getBufferSize() { return 3072; }
  bool publish(const char*,const char*,bool) { return false; }
  bool beginPublish(const char*,size_t,bool) { return false; }
  size_t write(const uint8_t*,size_t) { return 0; }
  bool endPublish() { return false; }
} mqtt;
struct WiFiClientSecure { int lastError(char*,size_t) { return 0; } };
struct FakeSocket:WiFiClientSecure {
  bool login(PubSubClient&,const char*,const char*,const char*) { return false; }
  void stop() {}
} tls;
const char MQTT_USERNAME[]="", MQTT_PASSWORD[]="", TOPIC[]="robot/amr01/commissioning";
portMUX_TYPE pulseMux=0,sensorMux=0;
amr_ir::PulseCounter leftPulses,rightPulses;
amr_ir::LocalController controller(700000,DIRECTION_INTERLOCK_US,160,20);
amr_ir::Sensors currentSensors;
bool startupReady=true,pwmReady=true;
#include "amr_route_control.h"
#undef gettimeofday

void fresh(uint64_t advance=0) {
  nowUs+=advance;
  currentSensors.imuValid=currentSensors.batteryValid=currentSensors.biasAvailable=true;
  currentSensors.imuTimeS=currentSensors.batteryTimeS=double(nowUs)/1000000;
  currentSensors.packV=currentSensors.busV=7.2;
}
std::string packet(const char* operation,uint32_t sequence,int left=0,int right=0,
                   const char* route="cccccccccccccccccccccccccccccccc") {
  char body[390],mac[65];
  std::snprintf(body,sizeof(body),"V1|%s|%s|%s|%u|%s|%d|%d|%llu|%llu",
      amr_route::guard.boot,amr_route::guard.epoch,route,sequence,operation,left,right,
      static_cast<unsigned long long>(amr_route::utcMs()),
      static_cast<unsigned long long>(amr_route::utcMs()+400));
  assert(amr_route::sign(body,mac));
  return std::string(body)+"|"+mac;
}
void post(const std::string& value,int expected) {
  webServer.input=value; amr_route::handleCommand(); assert(webServer.code==expected);
  assert(webServer.cache=="no-store");
}
int main() {
  fresh(); amr_route::setupReceiver(); amr_route::motorTick();
  assert(amr_route::ready && amr_route::linked); // MQTT is permanently unavailable above.
  const std::string boot=amr_route::guard.boot;
  amr_route::handleHardware();
  assert(webServer.code==200 && webServer.type=="text/plain" && webServer.body.rfind("H1|",0)==0);
  post(packet("arm",1),200); post(packet("drive",2,60,60),200); amr_route::motorTick();
  assert(amr_route::actualLeft==60 && amr_route::actualRight==60);
  assert(pins[STBY]==HIGH && pins[AIN1]==LOW && pins[AIN2]==HIGH);
  const auto before=amr_route::guard.seq;
  post(packet("drive",3,61,60),409); assert(amr_route::guard.seq==before);
  std::string bad=packet("drive",3,20,20); bad.back()=bad.back()=='a'?'b':'a';
  post(bad,401); assert(amr_route::guard.seq==before);
  post("bad",400); assert(amr_route::guard.seq==before);
  // Polling status cannot renew the 400ms command lease.
  fresh(399000); amr_route::handleHardware(); amr_route::motorTick();
  assert(amr_route::actualLeft==60);
  fresh(1001); amr_route::motorTick(); assert(amr_route::actualLeft==0 && !amr_route::guard.active);
  fresh(151000); amr_route::motorTick(); post(packet("arm",3),409);
  const char* second="dddddddddddddddddddddddddddddddd";
  post(packet("arm",3,0,0,second),200); post(packet("drive",4,40,40,second),200);
  amr_route::motorTick(); assert(amr_route::actualLeft==40);
  assert(!amr_route::localCommand('F') && !amr_route::localSpeed(30));
  assert(amr_route::localCommand('S')); amr_route::motorTick();
  assert(!amr_route::guard.active && amr_route::actualLeft==0);
  fresh(151000); amr_route::motorTick(); post(packet("drive",5,40,40,second),409);
  assert(amr_route::localCommand('F')); fresh(150001); amr_route::motorTick();
  assert(amr_route::actualLeft==160 && amr_route::actualRight==160);
  post(packet("arm",5,0,0,"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),409);
  assert(amr_route::localSpeed(0)); amr_route::motorTick(); assert(amr_route::actualLeft==0);
  // Route link changes cancel motion and reject packets from the former epoch.
  fresh(151000); amr_route::motorTick();
  const char* third="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  post(packet("arm",5,0,0,third),200); post(packet("drive",6,30,30,third),200);
  amr_route::motorTick(); const std::string delayed=packet("drive",7,30,30,third), epoch=amr_route::guard.epoch;
  WiFi.connected=0; amr_route::motorTick();
  assert(!amr_route::ready && !amr_route::guard.active && amr_route::actualLeft==0);
  WiFi.connected=WL_CONNECTED; fresh(151000); amr_route::motorTick();
  assert(amr_route::ready && boot==amr_route::guard.boot && epoch!=amr_route::guard.epoch);
  post(delayed,409);
  post(packet("arm",1),200); post(packet("drive",2,30,30),200); amr_route::motorTick();
  utcBase=0; amr_route::motorTick();
  assert(!amr_route::ready && !amr_route::guard.active && amr_route::actualLeft==0);
  utcBase=1700000000000ULL; fresh(151000); amr_route::motorTick();
  post(packet("arm",1),200); post(packet("drive",2,30,30),200); amr_route::motorTick();
  currentSensors.packV=AMR_ROUTE_MIN_PACK_V; amr_route::motorTick();
  assert(!amr_route::ready && !amr_route::guard.active && amr_route::actualLeft==0);
  fresh(151000); amr_route::motorTick();
  post(packet("arm",3,0,0,second),200); post(packet("drive",4,30,30,second),200); amr_route::motorTick();
  nowUs+=101000; amr_route::motorTick();
  assert(!amr_route::ready && !amr_route::guard.active && amr_route::actualLeft==0);
  // Route setup cannot disable the recovered manual HTTP/controller path.
  amr_route::routeKeyReady=false; fresh(151000); amr_route::motorTick();
  amr_route::handleHardware(); assert(webServer.code==503);
  assert(amr_route::localSpeed(100) && amr_route::localCommand('F'));
  fresh(150001); amr_route::motorTick(); assert(amr_route::actualLeft==100);
  assert(amr_route::localCommand('S')); amr_route::motorTick();
  amr_route::printStatus(); uint32_t attempt=0; amr_route::connectTelemetry("test",attempt);
  assert(!amr_route::publishTelemetry("{}",2));
  assert(amr_route::snapshot().left==0);
  puts("PASS: production route runtime HTTP, motor ownership, MQTT independence, Wi-Fi/clock/sensor loss and manual overrides");
}
