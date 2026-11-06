# 07. Security, physical safety and system limitations

## Software deployment

The local FastAPI admin/control endpoints are not protected by user accounts or roles. Keep them bound to `127.0.0.1`. Do not reverse-proxy this API to the public internet until authentication, role authorization, HTTPS, input limits, audit retention and secure hosting have been reviewed.

## MQTT boundary

`warehouse_twin/mqtt_gateway.py` is optional. It forwards device observations to the API through HTTP. A `TWIN_INGEST_TOKEN` can restrict telemetry ingestion, but that token **does not secure the rest of the API**. Use a secured MQTT broker, restricted topic permissions and TLS where applicable. Do not commit credentials, subscriber passwords, private locations or live sensor logs.

## Physical robot safety

The project does **not** send movement commands to equipment. No physical emergency-stop, fail-safe stop or personnel-zone detection is implemented. Do not use the simulated route restrictions as a personnel safety system.

## Streamlit Cloud limits

The Streamlit research app stores its mutable state per browser session in `st.session_state`. This prevents visitors changing a shared simulation but does not provide durable, server-authoritative event storage. Sessions may reset. The separate local FastAPI implementation uses SQLite but has not been deployed as a secure multi-user service.

## Scientific limits

- The route graph is illustrative, and edge lengths are synthetic.
- Timings are assumed, not physically calibrated.
- Replenishment requests and demand patterns are synthetic.
- Only one simulated robot is used.
- Changes to blocked nodes are allowed only while the robot is idle; there is no live mid-task path replanning.
- Physical ESP32 observations remain quarantined until an independently verified device schema, clock and coordinate system are available.
- The comparison of FIFO and urgency does not prove a causal effect in a real warehouse.
