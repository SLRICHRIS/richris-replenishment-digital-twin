# Verification Results

**Recorded:** 9 October 2026  
**Environment:** Python 3.12.14 · Streamlit 1.65.0 · Node.js 24.19.0

| Check | Result | Evidence |
|---|---|---|
| Mission, telemetry and interface behavior | Passed across five JavaScript suites | [JavaScript results](mission_and_interface_test_results.txt) |
| Streamlit startup and rerun identity | Passed | [Python results](streamlit_startup_test_results.txt) |
| Real server and application-file delivery | Passed; all 40 application files served byte-for-byte | [Server results](served_application_file_test_results.txt) |
| Local references and firmware download | Passed | [File-link results](file_link_test_results.txt) |

Runtime source is unchanged from the behavioral test run. File-link and server checks were repeated after the documentation and asset cleanup.

## Evidence boundaries

The interface tests use a test renderer. Deployed-browser WebGL behavior, physical ESP32 operation, sensor calibration and a real broker connection require separate verification. The hardware guide records an earlier reference compilation, not a new physical-device test.

## File integrity

[file_integrity_sha256.txt](file_integrity_sha256.txt) records file fingerprints relative to the repository root. It helps detect changed or missing files.

Commands are in the [testing guide](../automated_tests/README.md).
