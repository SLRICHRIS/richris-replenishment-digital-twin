// Runs the production LAN wire parser and motor guard without any hardware.
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
#include <openssl/hmac.h>
#include "route_http_protocol.h"

namespace {
constexpr char KEY[] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
constexpr char BOOT[] = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
constexpr char EPOCH[] = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
constexpr char ROUTE[] = "cccccccccccccccccccccccccccccccc";
constexpr char NEXT_ROUTE[] = "dddddddddddddddddddddddddddddddd";
constexpr char NEXT_EPOCH[] = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
constexpr uint64_t UTC = 1700000000000ULL;
using amr_route_wire::Result;

bool sign(const char* body, char* output) {
  unsigned char mac[EVP_MAX_MD_SIZE];
  unsigned length = 0;
  if (!HMAC(EVP_sha256(), KEY, 64, reinterpret_cast<const unsigned char*>(body),
            std::strlen(body), mac, &length) || length != 32) return false;
  for (unsigned i = 0; i < length; ++i) std::snprintf(output + 2*i, 3, "%02x", unsigned(mac[i]));
  return true;
}

bool failedSign(const char*, char*) { return false; }

std::string signedBody(const std::string& body) {
  char signature[65];
  assert(sign(body.c_str(), signature));
  return body + "|" + signature;
}

std::string packet(const char* operation, uint32_t seq, int left, int right,
                   uint64_t issued, uint64_t expires, const char* route = ROUTE,
                   const char* epoch = EPOCH, const char* boot = BOOT) {
  return signedBody(std::string("V1|") + boot + "|" + epoch + "|" + route + "|" +
      std::to_string(seq) + "|" + operation + "|" + std::to_string(left) + "|" +
      std::to_string(right) + "|" + std::to_string(issued) + "|" + std::to_string(expires));
}

amr_vision::Command decoded(const std::string& wire) {
  amr_vision::Command command;
  assert(amr_route_wire::decode(wire.data(), wire.size(), sign, command) == Result::accepted);
  return command;
}

void authenticationAndParsing() {
  const std::string good = packet("arm", 1, 0, 0, UTC, UTC + 500);
  amr_vision::Command command;
  assert(amr_route_wire::decode(good.data(), good.size(), sign, command) == Result::accepted);
  assert(command.seq == 1 && command.issued == UTC && command.expires == UTC + 500);
  assert(std::strcmp(command.boot, BOOT) == 0 && std::strcmp(command.epoch, EPOCH) == 0);
  assert(amr_route_wire::decode(nullptr, good.size(), sign, command) == Result::malformed);
  assert(amr_route_wire::decode(good.data(), good.size(), nullptr, command) == Result::malformed);
  assert(amr_route_wire::decode(good.data(), good.size(), failedSign, command) == Result::unauthorized);
  std::string changed = good;
  changed.back() = changed.back() == 'a' ? 'b' : 'a';
  assert(amr_route_wire::decode(changed.data(), changed.size(), sign, command) == Result::unauthorized);
  changed = good;
  changed[10] = '\0';
  assert(amr_route_wire::decode(changed.data(), changed.size(), sign, command) == Result::malformed);
  changed = good + std::string(451, 'x');
  assert(amr_route_wire::decode(changed.data(), changed.size(), sign, command) == Result::malformed);
  for (const auto& bad : {
      packet("arm", 0, 0, 0, UTC, UTC + 500),
      packet("arm", 1, 1, 0, UTC, UTC + 500),
      packet("stop", 1, 0, 1, UTC, UTC + 500),
      packet("drive", 1, 256, 0, UTC, UTC + 500),
      packet("drive", 1, -256, 0, UTC, UTC + 500),
      packet("launch", 1, 0, 0, UTC, UTC + 500),
      packet("arm", 1, 0, 0, UTC, UTC + 500, "invalid-route"),
      signedBody(std::string("V1|") + BOOT + "|" + EPOCH + "|" + ROUTE + "|4294967296|arm|0|0|1700000000000|1700000000500"),
      signedBody(std::string("V1|") + BOOT + "|" + EPOCH + "|" + ROUTE + "|1|drive|-|0|1700000000000|1700000000500"),
      signedBody(std::string("V1|") + BOOT + "|" + EPOCH + "|" + ROUTE + "|1|drive|0|0|1700000000000|1700000000500|extra")}) {
    assert(amr_route_wire::decode(bad.data(), bad.size(), sign, command) == Result::malformed);
  }
}

void leasesAndReadOnlyStatus() {
  amr_vision::Guard guard;
  guard.connection(BOOT, EPOCH);
  auto arm = decoded(packet("arm", 1, 0, 0, UTC, UTC + 500));
  // A laptop 220 ms ahead can accept fresh H1 but its raw-clock V1 is
  // future-dated beyond the receiver's unchanged 100 ms tolerance.
  assert(!guard.accept(decoded(packet("arm", 1, 0, 0, UTC + 220, UTC + 720)), UTC, 0, true, 60));
  assert(!guard.accept(arm, UTC, 0, false, 60));
  assert(!guard.accept(decoded(packet("drive", 1, 20, 20, UTC, UTC + 500)), UTC, 0, true, 60));
  assert(guard.accept(arm, UTC, 0, true, 60));
  assert(!guard.accept(arm, UTC, 0, true, 60));
  const auto drive = decoded(packet("drive", 2, 60, 60, UTC + 100, UTC + 600));
  assert(guard.accept(drive, UTC + 100, 100000, true, 60));
  guard.tick(100000, true);
  assert(guard.active && guard.left == 60 && guard.right == 60);
  assert(!guard.accept(decoded(packet("drive", 3, 61, 0, UTC + 100, UTC + 600)), UTC + 100, 100000, true, 60));
  assert(!guard.accept(decoded(packet("drive", 3, 20, 20, UTC, UTC + 501)), UTC + 100, 100000, true, 60));
  assert(!guard.accept(decoded(packet("drive", 3, 20, 20, UTC, UTC + 100)), UTC + 100, 100000, true, 60));
  assert(!guard.accept(decoded(packet("drive", 3, 20, 20, UTC + 201, UTC + 600)), UTC + 100, 100000, true, 60));
  assert(!guard.accept(decoded(packet("drive", 3, 20, 20, UTC + 200, UTC + 150)), UTC + 100, 100000, true, 60));
  assert(!guard.accept(decoded(packet("drive", 3, 20, 20, UTC + 100, UTC + 600, ROUTE, NEXT_EPOCH)), UTC + 100, 100000, true, 60));
  assert(!guard.accept(decoded(packet("drive", 3, 20, 20, UTC + 100, UTC + 600, ROUTE, EPOCH, NEXT_EPOCH)), UTC + 100, 100000, true, 60));
  char status[470];
  for (uint32_t seq = 0; seq < 20; ++seq) {
    assert(amr_route_wire::hardware(status, sizeof(status), guard, seq, 60, 60, 7400,
                                   true, UTC + 599, sign) > 0);
    assert(guard.seq == 2 && guard.active && guard.left == 60);
  }
  assert(amr_route_wire::hardware(status, 1, guard, 1, 0, 0, 7400, true, UTC, sign) == -1);
  assert(amr_route_wire::hardware(status, sizeof(status), guard, 1, 0, 0, 7400, true, UTC, failedSign) == -1);
  guard.tick(599999, true);
  assert(guard.active && guard.left == 60);
  guard.tick(600000, true);
  assert(!guard.active && guard.left == 0 && guard.right == 0);
  assert(std::strcmp(guard.state, "expired") == 0);
  assert(!guard.accept(decoded(packet("arm", 3, 0, 0, UTC + 700, UTC + 1200)), UTC + 700, 700000, true, 60));
}

void overridesAndInterlocks() {
  amr_vision::Guard guard;
  guard.connection(BOOT, EPOCH);
  assert(guard.accept(decoded(packet("arm", 1, 0, 0, UTC, UTC + 500)), UTC, 0, true, 60));
  assert(guard.accept(decoded(packet("drive", 2, 30, 20, UTC + 100, UTC + 600)), UTC + 100, 100000, true, 60));
  guard.tick(100000, true);
  assert(guard.left == 30 && guard.right == 20);
  assert(guard.accept(decoded(packet("drive", 3, -30, 20, UTC + 200, UTC + 700)), UTC + 200, 200000, true, 60));
  guard.tick(200000, true);
  assert(guard.active && guard.left == 0 && guard.right == 0);
  guard.tick(349999, true);
  assert(guard.left == 0 && guard.right == 0);
  guard.tick(350000, true);
  assert(guard.left == -30 && guard.right == 20);
  guard.stop("local_stop");
  assert(!guard.active && guard.left == 0 && guard.right == 0);
  assert(!guard.accept(decoded(packet("drive", 4, 20, 20, UTC + 400, UTC + 900)), UTC + 400, 400000, true, 60));
  assert(!guard.accept(decoded(packet("arm", 4, 0, 0, UTC + 400, UTC + 900)), UTC + 400, 400000, true, 60));
  assert(guard.accept(decoded(packet("arm", 4, 0, 0, UTC + 400, UTC + 900, NEXT_ROUTE)), UTC + 400, 400000, true, 60));
  assert(guard.accept(decoded(packet("drive", 5, 20, 20, UTC + 500, UTC + 1000, NEXT_ROUTE)), UTC + 500, 500000, true, 60));
  guard.tick(700000, false);
  assert(!guard.active && guard.left == 0 && guard.right == 0);
  assert(std::strcmp(guard.state, "unavailable") == 0);
  guard.connection(BOOT, NEXT_EPOCH);
  assert(!guard.accept(decoded(packet("arm", 1, 0, 0, UTC + 800, UTC + 1300)), UTC + 800, 800000, true, 60));
  assert(guard.accept(decoded(packet("arm", 1, 0, 0, UTC + 800, UTC + 1300, ROUTE, NEXT_EPOCH)), UTC + 800, 800000, true, 60));
  assert(guard.accept(decoded(packet("stop", 2, 0, 0, UTC + 900, UTC + 1400, ROUTE, NEXT_EPOCH)), UTC + 900, 900000, true, 60));
  assert(!guard.active && std::strcmp(guard.state, "stopped") == 0);
}
}  // namespace

int main() {
  authenticationAndParsing();
  leasesAndReadOnlyStatus();
  overridesAndInterlocks();
  // The Python checker supplies its own production V1/HMAC output, then
  // verifies these production H1 responses using the backend verifier.
  std::string wire;
  assert(std::getline(std::cin, wire));
  amr_vision::Guard guard;
  guard.connection(BOOT, EPOCH);
  const auto command = decoded(wire);
  assert(guard.accept(command, UTC, 0, true, 200));
  char status[470];
  assert(amr_route_wire::hardware(status, sizeof(status), guard, 1, 0, 0, 7400, true, UTC, sign) > 0);
  std::cout << status << '\n';
  assert(guard.accept(decoded(packet("drive", 2, 200, -200, UTC + 100, UTC + 600)), UTC + 100, 100000, true, 200));
  guard.tick(100000, true);
  assert(amr_route_wire::hardware(status, sizeof(status), guard, 2, guard.left, guard.right, 7390, true, UTC + 100, sign) > 0);
  std::cout << status << '\n';
}
