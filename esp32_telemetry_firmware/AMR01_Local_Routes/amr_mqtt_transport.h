#pragma once
#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>

namespace amr_mqtt {

// PubSubClient polls available() continuously while waiting for CONNACK.
// Yield on an empty poll during login so the ESP32 can service its other tasks.
class Socket final : public WiFiClientSecure {
 public:
  bool login(PubSubClient& client, const char* id, const char* user, const char* password) {
    client.setSocketTimeout(15);
    waitingForLogin_ = true;
    const bool accepted = client.connect(id, user, password);
    waitingForLogin_ = false;
    client.setSocketTimeout(2);
    return accepted;
  }

  int available() override {
    const int count = WiFiClientSecure::available();
    if (count == 0 && waitingForLogin_) vTaskDelay(1);
    return count;
  }

 private:
  bool waitingForLogin_ = false;
};

}  // namespace amr_mqtt
