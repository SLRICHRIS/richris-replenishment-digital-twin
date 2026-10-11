# Replenish edge evidence kit

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.

This kit records ESP32 measurements in SQLite and translates actual LabVIEW/perception inventory observations to the browser's MQTT contract. It does not issue motor commands, replace the Coordinator, or establish that the AMRs have been physically validated.

## Install and archive

Run all commands from the repository root or the extracted starter-kit root.

Use Python 3.10 or later on the edge computer. Create a virtual environment and install the network dependency:

```sh
python -m venv .venv
# Activate the virtual environment using the command appropriate for your OS.
python -m pip install -r backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt
```

Set `MQTT_HOST` to the broker hostname and `MQTT_USER` to a read-only archive account. `MQTT_PREFIX` defaults to `richris/warehouse01`; `MQTT_TLS_PORT` defaults to `8883`. The password is requested privately if `MQTT_PASSWORD` is not set. `MQTT_CA` can name a private CA certificate. TLS certificate verification remains enabled.

```sh
python -m backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.mqtt_telemetry_recorder_and_inventory_publisher record --database warehouse-evidence.sqlite3
```

The recorder subscribes to the three `/amr-0N/telemetry` topics and `/inventory`. It writes accepted observations and rejection reasons, preserving receiver wall time and monotonic time. A bounded queue decouples the MQTT network callback from SQLite commits. The queue can overflow; the shutdown report counts overflows. QoS 0 collection is not lossless. Device ACLs must restrict each publisher to its own topic; a `device_id` string is not cryptographic proof of device identity.

Stop with Ctrl+C. Export the most recent connection session:

```sh
python -m backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.mqtt_telemetry_recorder_and_inventory_publisher export --database warehouse-evidence.sqlite3 --output physical-recording.json
```

Import the JSON in **Twin lab → Import recording**. Each browser import accepts up to 6,000 events and 6 MB. Use `--last` to choose a smaller window and `--session` to select a previous session. SQLite retains the complete archive. The export's physical provenance is a declaration that the connected streams came from hardware; synthetic publishers must be labeled synthetic before use in the lab.

## Connect the perception path

Use a separate publisher account with write access only to `<prefix>/inventory`. Run this bridge independently of the operator command loop:

```sh
python -m backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.mqtt_telemetry_recorder_and_inventory_publisher vision --source labview-vision --frame warehouse-01
```

Feed newline-delimited observations to stdin from the acquisition process:

```json
{"captured_at_ms":1760000000000,"bins":{"A":12,"B":0}}
```

The example timestamp is illustrative. Supply the actual acquisition Unix timestamp in milliseconds. An old timestamp will be rejected. Zero means an observed empty bin; omit bins that have not been measured. A bounding box or detector confidence is not a calibrated stock count.

`backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.labview_inventory_observation_adapter.inventory_observation(captured_at_ms, counts_json)` is a pure function suitable for a LabVIEW Python Node. It returns one validated observation line and performs no network work. Forward that output from the perception process to the separately running bridge. The adapter does not start or rewire your LabVIEW VI. Keep network waits and perception work away from the override loop; verify that separation experimentally.

## Asset-frame metadata

`backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/example_warehouse_route_graph_for_calibration.json` contains the same illustrative 22-node, 27-link route graph used by the twelve-rack reference floor: three bays, four A–D loading stops, three cross aisles and four connecting lanes. Eight additional racks are reserve storage with no measured stock contract. The example is unverified. Survey and replace its coordinates and edges for your testbed before confirming geometry in Twin lab; an imported graph does not change the reference 3D warehouse.

Existing ESP32 v1 packets continue to work. Add these optional fields only when actual localization supplies them:

```json
{"frame_id":"warehouse-01","pose_source":"overhead_camera","pose_sigma_m":0.03,"angular_speed_rps":0.0}
```

Pose is measured in metres. The reference plan uses +X right and +Y down; heading 0° follows +X and +90° follows +Y, so positive heading/angular speed appears clockwise in the plan. Transform localization into this frame before publishing. `pose_source` accepts `encoder_odometry`, `overhead_camera`, `uwb`, or `external`. `pose_sigma_m` is an estimate of measurement noise; it must not be confused with detector confidence. Omit metadata you cannot measure. Confirm origin, axes, scale and heading against surveyed reference points before enabling prediction.

## Verification

```sh
python -m unittest discover -s automated_software_checks/python_telemetry_service_checks -p 'test_*.py' -v
```

Tests cover decoding, unknown readings, duplicate/reboot/retained rejection, the LabVIEW adapter, session selection and SQLite export. These tests require no broker. Actual broker ACLs, clock synchronization, sensors, receiver throughput and physical AMR behavior still need commissioning.

See [the architecture and validation plan](digital_twin_architecture_and_validation_plan.md) for the full model contract, physical evaluation protocol and control-path requirements.
