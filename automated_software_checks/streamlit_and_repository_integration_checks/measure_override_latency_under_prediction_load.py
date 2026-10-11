"""Reproducible SOFTWARE benchmark; not ESP32, network or motor latency.

Exercises the production HTTP handler + Coordinator + simulated execution ACK.
Separate Node processes continuously run the production paired prediction model.
"""

import argparse
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend_streamlit_and_telemetry.operator_override_control_channel.operator_override_command_coordinator import (
    CommandCoordinator,
    handler_for,
)


def percentile(values, fraction):
    values = sorted(values)
    return (
        values[min(len(values) - 1, int((len(values) - 1) * fraction + 0.5))]
        if values
        else None
    )


def benchmark(count=100):
    inbox = queue.Queue()
    coordinator = CommandCoordinator(lambda asset, packet: inbox.put((asset, packet)))
    token = "software-benchmark-only-" + "x" * 32
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(coordinator, token))
    http_thread = threading.Thread(target=server.serve_forever, daemon=True)
    http_thread.start()
    stop = threading.Event()

    def device():
        while not stop.is_set():
            try:
                asset, packet = inbox.get(timeout=0.1)
            except queue.Empty:
                continue
            time.sleep(0.002)  # Deliberate simulated controller execution delay.
            ack = {
                "v": 1,
                "command_id": packet["command_id"],
                "device_id": asset,
                "boot_id": packet["target_boot_id"],
                "status": "executed",
            }
            coordinator.acknowledge(asset, json.dumps(ack).encode())

    device_thread = threading.Thread(target=device, daemon=True)
    device_thread.start()
    modules = ROOT / "frontend_warehouse_dashboard/browser_modules"
    load_script = f"""
+import {{comparePolicies}} from {json.dumps((modules / 'robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js').as_uri())};
+import {{defaultProfile}} from {json.dumps((modules / 'robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js').as_uri())};
+import {{homeFor,MODEL}} from {json.dumps((modules / 'robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js').as_uri())};
+import {{BIN_DESTINATIONS}} from {json.dumps((modules / 'warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js').as_uri())};
+const snapshot={{provenance:'synthetic',units:[0,1,2].map(id=>({{id:'amr-0'+(id+1),x_m:homeFor({{id}}).x/MODEL.scale,y_m:homeFor({{id}}).y/MODEL.scale,battery_pct:90,state:'idle',profile:defaultProfile('amr-0'+(id+1))}})),bins:BIN_DESTINATIONS.map(b=>({{id:b.id,count:b.stock,rate:b.rate,x_m:b.x/MODEL.scale,y_m:b.y/MODEL.scale}}))}};
+comparePolicies(snapshot,{{policy:'urgency',horizonS:120,demandMultiplier:5,speedFactor:1}});
+console.log('READY');
+while(true)comparePolicies(snapshot,{{policy:'urgency',horizonS:120,demandMultiplier:5,speedFactor:1}});
+""".replace("\n+", "\n")
    rows = []
    sequence = 0
    workers = []
    try:
        for label, process_count in [
            ("idle", 0),
            ("normal_prediction", 1),
            ("heavy_prediction", 2),
        ]:
            workers = [
                subprocess.Popen(
                    ["node", "--input-type=module", "-e", load_script],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for _ in range(process_count)
            ]
            for worker in workers:
                if worker.stdout.readline().strip() != "READY":
                    raise RuntimeError(
                        "Prediction worker failed: " + worker.stderr.read()[:400]
                    )
            latencies, failures = [], {}
            for _ in range(count):
                sequence += 1
                now = time.time_ns() // 1000000
                telemetry = {
                    "v": 1,
                    "device_id": "amr-01",
                    "boot_id": "01234567abcdef00",
                    "seq": sequence,
                    "sent_at_ms": now,
                    "uptime_ms": sequence,
                    "state": "idle",
                    "firmware": "richris-esp32-1.0.0",
                    "battery_pct": None,
                    "pose": None,
                    "speed_mps": None,
                    "wifi_rssi_dbm": -60,
                }
                coordinator.observe("amr-01", json.dumps(telemetry).encode())
                request = Request(
                    f"http://127.0.0.1:{server.server_port}/commands",
                    json.dumps({"device_id": "amr-01", "action": "stop"}).encode(),
                    {
                        "Authorization": "Bearer " + token,
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                with urlopen(request, timeout=3) as response:
                    result = json.load(response)
                while result["status"] not in {"executed", "rejected", "timed_out"}:
                    time.sleep(0.0005)
                    status_request = Request(
                        f"http://127.0.0.1:{server.server_port}/commands/"
                        + result["packet"]["command_id"],
                        headers={"Authorization": "Bearer " + token},
                    )
                    with urlopen(status_request, timeout=3) as response:
                        result = json.load(response)
                if result["status"] == "executed":
                    latencies.append(result["latency_ms"])
                else:
                    failures[result["status"]] = failures.get(result["status"], 0) + 1
            rows.append(
                {
                    "load": label,
                    "prediction_processes": process_count,
                    "requests": count,
                    "executed": len(latencies),
                    "failures": failures,
                    "p50_ms": percentile(latencies, 0.5),
                    "p95_ms": percentile(latencies, 0.95),
                    "p99_ms": percentile(latencies, 0.99),
                    "maximum_ms": max(latencies, default=None),
                }
            )
            for worker in workers:
                worker.terminate()
                worker.wait(timeout=5)
            workers = []
    finally:
        for worker in workers:
            worker.kill()
            worker.wait()
        stop.set()
        device_thread.join(timeout=2)
        server.shutdown()
        server.server_close()
        http_thread.join(timeout=2)
        coordinator.close()
    return {
        "evidence": "software-loopback-with-simulated-controller",
        "clock": "Coordinator time.monotonic_ns",
        "simulated_execution_delay_ms": 2,
        "prediction_workload": "production comparePolicies, separate Node processes",
        "results": rows,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests", type=int, default=100)
    args = parser.parse_args()
    if not 10 <= args.requests <= 10000:
        parser.error("Use 10..10000 requests per load")
    print(json.dumps(benchmark(args.requests), indent=2))
