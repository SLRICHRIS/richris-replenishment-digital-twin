# Verification Results

**Recorded:** 11 October 2026  
**Runtime:** Python 3.12.14 · Streamlit 1.65.0 · Node.js 24.19.0 · jsdom 26.1.0

| Check | Result | Evidence |
| --- | --- | --- |
| Audited application behavior and host bridge | All 11 JavaScript suites passed | [JavaScript results](mission_and_interface_test_results.txt) |
| Shortest-path correctness | 2,940 independent optimality checks | JavaScript results above |
| Map and reassignment | 288 route/trace/playback combinations and 288 reassignment configurations | JavaScript results above |
| Streamlit startup and stable component identity | Passed startup and ordinary rerun | [Startup results](streamlit_startup_test_results.txt) |
| Actual server and file transport | Local HTTP/WebSocket session passed; application files matched bytes with correct JS/CSS/HTML MIME types | [Served-file results](served_application_file_test_results.txt) |
| Source/guide links and kit contents | Local references, configured-secret exclusions and both kits checked | [File-link results](file_link_test_results.txt) |
| Optional edge gateway | Six standard-library Python tests passed | [Edge results](edge_gateway_test_results.txt) |

## Streamlit scroll correction

The component originally depended on document scrolling while its iframe and host cropped overflow. The correction provides an explicit main-workspace scroll region, preserving the header and navigation. Its targeted DOM/protocol checks cover all seven views, keyboard access, unchanged-view scroll retention, focus preservation and cleanup. Streamlit startup, served files and local references were checked again. [Scroll correction evidence](streamlit_scroll_fix_results.txt) records these results. Live browser and hosted Cloud verification remain pending.

## Release lineage

The imported Site release is `e8dbe22a7ef06e7016f2a2bf35251a4086f910be`. [Source migration fingerprints](audited_source_migration.json) record original and adapted paths/bytes. The application preserves the existing descriptive GitHub filenames and adds the Streamlit readiness/viewport bridge.

The tests were run on the migrated files. No physical robot accuracy, real broker operation, LabVIEW command channel, deployed Streamlit Cloud session or browser/GPU rendering is established by these checks.

Synthetic holdout and policy outcomes are software evidence, not physical performance measurements. Physical sensor calibration, map alignment and ground-truth validation remain separate tasks.

[File integrity](file_integrity_sha256.txt) records repository file fingerprints. Reproduction commands are in the [testing guide](../automated_tests/README.md).

