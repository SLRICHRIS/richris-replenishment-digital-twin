# Repository verification

Recorded on 11 October 2026 using Python 3.12.14, Streamlit 1.65.0, Node.js 24.19.0 and jsdom 26.1.0.

## Current structure verification

| Check | Result |
| --- | --- |
| Frontend behavior | All 11 suites passed |
| Shortest-path correctness | 2,940 independent oracle comparisons passed |
| Route map and reassignment | 288 map combinations and 288 reassignment configurations passed |
| Backend observation recorder | Six standard-library unit tests passed |
| Streamlit host | Startup and ordinary rerun passed with stable component identity |
| Actual local server | All 60 frontend files served byte-for-byte with valid JS/CSS/HTML MIME types |
| References and boundaries | Local file links, document-relative workers, unique HTML IDs and separated source folders passed |
| Source migration | All 104 previous tracked files accounted for |
| Generated downloads | Two ZIPs, three documents and ownership notice match canonical sources; 4 firmware and 15 edge kit members verified |
| Extracted edge kit | All six tests passed from the extracted directory |
| Syntax and behavior preservation | 19 browser modules and 16 Python modules parse; browser logic matches the previous release after dependency-path normalization |

[Structured results](repository_reorganization_results.json) record commands, counts and verification scope. [Frontend execution output](frontend_reorganization_test_results.txt) records the behavior suites. [Integration results](integration_reorganization_test_results.txt) record served assets, references and extracted kit checks. [Current SHA-256 fingerprints](current_repository_sha256.txt) identify the repository files; the fingerprint manifest excludes itself.

The root deployment entrypoint remains `streamlit_app.py`. Python hosting now lives in `backend/streamlit_dashboard_host.py`; browser modules live in `frontend/src/`. The bridge retains its trusted-parent protocol, fixed viewport sizing and seven-view scroll behavior. The component name changed to match its Python module location, while its widget key remains stable.

## Historical lineage

The previous GitHub release is `083d2b861ade96daf20668a92978f8a7b731bbdb`. The audited Site source is `e8dbe22a7ef06e7016f2a2bf35251a4086f910be`. The [old-to-new path map](repository_path_migration.json) includes every previously tracked file.

[Previous release evidence](previous_release/) preserves earlier test logs, the scrolling correction, original source-migration fingerprints and the previous file-integrity record. Paths in those archived records describe the previous release. Current source and evidence use the new folders.

## Scope

These checks establish software behavior and local Streamlit hosting. The hosted Cloud session, actual browser/GPU rendering, physical robot accuracy, broker operation and the LabVIEW command channel remain unverified. Synthetic model results remain software evidence.

Reproduction commands are in the [testing guide](../../tests/README.md).

