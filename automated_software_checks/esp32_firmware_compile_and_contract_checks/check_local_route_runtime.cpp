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
struct FakeIP {
  uint32_t value=112;
  operator uint32_t() const { return value; }
  std::string toString() const { return std::to_string(value); }
};
struct FakeWiFi {
  int connected=WL_CONNECTED;
  FakeIP address;
  int status() { return connected; }
  FakeIP localIP() { return address; }
  int RSSI() { return -45; }
} WiFi;
enum arduino_event_id_t {
  ARDUINO_EVENT_WIFI_STA_START, ARDUINO_EVENT_WIFI_STA_STOP,
  ARDUINO_EVENT_WIFI_STA_GOT_IP, ARDUINO_EVENT_WIFI_STA_LOST_IP,
  ARDUINO_EVENT_WIFI_STA_DISCONNECTED
};
struct arduino_event_info_t { struct { unsigned reason=0; } wifi_sta_disconnected; };
std::map<int,int> pins, duties;
void digitalWrite(int pin,int value) { pins[pin]=value; }
bool writeMotorPwm(int pin,uint32_t duty) { duties[pin]=int(duty); return true; }
struct FakeSerial {
  void println(const char*) {}
  template <typename... T> void printf(const char*,T...) {}
} Serial;
struct FakeListener {
  bool active=false;
  operator bool() const { return active; }
};
struct FakeClient {
  bool active=false;
  int stops=0;
  void stop() { active=false; ++stops; }
};
class WebServer {
 protected:
  FakeListener _server;
 public:
  explicit WebServer(int) {}
  std::string input,body,type,cache;
  bool hasBody=true;
  int code=0;
  int begins=0,closes=0,handles=0;
  bool beginAllowed=true;
  FakeClient current;
  FakeClient& client() { return current; }
  void begin() { close(); ++begins; _server.active=beginAllowed; }
  void close() { ++closes; _server.active=false; }
  void handleClient() { assert(_server.active); ++handles; }
  bool hasArg(const char*) { return hasBody; }
  String arg(const char*) { return input; }
  void sendHeader(const char*,const char* value) { cache=value; }
  void send(int status,const char* mime,const char* value) { code=status;type=mime;body=value; }
};
#include "local_wifi_test_behaviors.h"
amr_wifi::Receiver webServer(80);
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

void checkHttpRecovery() {
  arduino_event_info_t info;
  info.wifi_sta_disconnected.reason=200;
  WiFi.connected=0;
  amr_wifi::service(webServer);
  assert(webServer.begins==0 && webServer.handles==0);
  // Association alone is insufficient; wait for a usable IP event.
  WiFi.connected=WL_CONNECTED;
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_START,info);
  amr_wifi::service(webServer);
  assert(webServer.begins==0);
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_GOT_IP,info);
  amr_wifi::service(webServer);
  assert(webServer.begins==1 && amr_wifi::http.started && webServer.handles==1);
  amr_wifi::service(webServer);
  assert(webServer.begins==1 && webServer.handles==2);

  webServer.current.active=true;
  const int closes=webServer.closes;
  WiFi.connected=0;
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_DISCONNECTED,info);
  assert(webServer.closes==closes && webServer.current.active); // callback never touches sockets
  amr_wifi::service(webServer);
  assert(!webServer.current.active && !amr_wifi::http.started && !webServer.listening());
  amr_wifi::service(webServer);
  assert(webServer.handles==2 && webServer.begins==1);
  WiFi.connected=WL_CONNECTED;
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_GOT_IP,info);
  amr_wifi::service(webServer);
  assert(webServer.begins==2 && amr_wifi::http.address==112);

  // Both events can arrive between loop calls, even with the same address.
  webServer.current.active=true;
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_DISCONNECTED,info);
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_GOT_IP,info);
  amr_wifi::service(webServer);
  assert(webServer.begins==3 && !webServer.current.active);
  assert(amr_wifi::snapshot().disconnects==2 && amr_wifi::snapshot().lastReason==200);
  WiFi.address.value=113;
  amr_wifi::service(webServer);
  assert(webServer.begins==4 && amr_wifi::http.address==113);

  // A failed listen must not be labelled started or retried in a tight loop.
  webServer.beginAllowed=false;
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_GOT_IP,info);
  const int handled=webServer.handles;
  amr_wifi::service(webServer);
  assert(webServer.begins==5 && !amr_wifi::http.started);
  nowUs+=999000; amr_wifi::service(webServer);
  assert(webServer.begins==5 && webServer.handles==handled);
  nowUs+=1000; amr_wifi::service(webServer);
  assert(webServer.begins==6 && !amr_wifi::http.started);
  webServer.beginAllowed=true;
  nowUs+=1000000; amr_wifi::service(webServer);
  assert(webServer.begins==7 && amr_wifi::http.started);
  webServer.close(); amr_wifi::service(webServer);
  assert(webServer.begins==8 && amr_wifi::http.started);

  // Lost IP and station stop must close HTTP even before status/IP polling changes.
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_LOST_IP,info);
  amr_wifi::service(webServer);
  assert(!amr_wifi::http.started && !webServer.listening());
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_STOP,info);
  amr_wifi::service(webServer);
  assert(webServer.begins==8);
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_GOT_IP,info);
  amr_wifi::service(webServer);
  assert(webServer.begins==9 && amr_wifi::http.started);
  puts("PASS: production HTTP lifecycle: IP readiness, same-IP/fast reconnect, client cleanup, IP change, lost IP and bounded listen retry");
}

int main() {
  checkHttpRecovery();
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
  const std::string quickDelayed=packet("drive",3,30,30), quickEpoch=amr_route::guard.epoch;
  arduino_event_info_t reconnect;
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_DISCONNECTED,reconnect);
  amr_wifi::onEvent(ARDUINO_EVENT_WIFI_STA_GOT_IP,reconnect);
  amr_route::motorTick();
  assert(amr_route::actualLeft==0 && !amr_route::guard.active && quickEpoch!=amr_route::guard.epoch);
  post(quickDelayed,409);
  fresh(151000); amr_route::motorTick();
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
