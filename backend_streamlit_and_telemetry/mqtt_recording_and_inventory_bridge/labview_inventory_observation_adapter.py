"""Pure acquisition adapter for a LabVIEW Python Node. No network call or motor code.
Pass actual bin counts and the capture timestamp from the perception pipeline.
The returned newline JSON feeds the separate mqtt_telemetry_recorder_and_inventory_publisher.py vision process.
© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
"""
import json

def inventory_observation(captured_at_ms, counts_json):
    """Return one observation line. Unknown bins are omitted; never default to zero."""
    if type(captured_at_ms) is not int or captured_at_ms < 0:
        raise ValueError("Pass the actual acquisition timestamp in Unix milliseconds")
    counts=json.loads(counts_json)
    if type(counts) is not dict or not 1<=len(counts)<=4:
        raise ValueError("Pass a JSON object with 1–4 actually measured bins")
    for id,count in counts.items():
        if id not in {"A","B","C","D"} or type(count) is not int or not 0<=count<=100:
            raise ValueError("Counts must be integers from 0–100 for unique A–D bins")
    return json.dumps({"captured_at_ms":captured_at_ms,"bins":counts},separators=(",",":"))+"\n"
