# Current software and repository naming checks

Recorded on 11 October 2026 using Python 3.12.14, Streamlit 1.65.0, Node.js 24.19.0 and jsdom 26.1.0.

## Verified descriptive names

All 128 preceding files are accounted for. 121 file paths use more descriptive names; the remaining root filenames retain framework conventions. Two new documents record the complete file-purpose catalog and the 128-file rename history, bringing the repository to 130 files.

| Check | Result |
| --- | --- |
| Browser behavior | All 11 suites passed |
| Shortest paths | 2,940 independent oracle comparisons passed |
| Route map and reassignment | 288 map combinations and 288 reassignment configurations passed |
| Python telemetry services | Six unit tests passed |
| Streamlit host | Startup and ordinary rerun passed with stable identity |
| Real local Streamlit transport | All 60 frontend files served byte-for-byte with valid script/style/document MIME types |
| Source references and boundaries | Local links, document-relative workers, unique HTML IDs and frontend/backend/firmware separation passed |
| Rename coverage | All 128 files in the immediately preceding release and all 104 original audited application files accounted for |
| Generated kits/documents | Six downloads match canonical sources; 4 firmware and 15 recorder-kit members verified |
| Extracted recorder kit | All six tests passed from its extracted directory |
| Logic and syntax | 25 browser/application-library JavaScript files preserve logic after import/worker-path normalization and parse; 16 Python files parse |
| Firmware compatibility | Arduino folder and sketch names match; sketch changes only its configured-header include name |
| File integrity | SHA-256 fingerprints cover the 129 repository files other than the fingerprint manifest |

[Structured results](repository_naming_and_structure_check_results.json), [browser suite output](browser_behavior_check_results.txt) and [Python/host/download output](python_host_repository_and_download_check_results.txt) record the checks. [Current file hashes](current_repository_file_hashes_sha256.txt) identify the final source and evidence.

The Streamlit Cloud entrypoint stays `streamlit_app.py`. Python hosting is in `backend_streamlit_and_telemetry/streamlit_dashboard_host.py`. Browser modules are in `frontend_warehouse_dashboard/browser_modules/`. The trusted-parent bridge, viewport sizing and seven-view workspace scrolling remain intact. The component name matches its new Python package; its widget key remains stable.

## Source history

The preceding GitHub commit is `ce7f198c967ff6c68a763dcb490c61c79a8bf000`. The [descriptive name migration](repository_descriptive_name_migration.json) preserves all 128 preceding paths and Git blob hashes. The [original audited application path history](audited_application_file_path_history.json) maps the earlier 104-file migration to the current names.

The audited Site source is `e8dbe22a7ef06e7016f2a2bf35251a4086f910be`. [Previous release logs and hashes](previous_release_test_logs_and_file_hashes/) retain their historical content and original path values.

The [purpose of every file](../all_repository_file_purposes.md) explains all current paths and required framework naming conventions.

## Verification scope

These checks establish software behavior and local Streamlit hosting. Actual hosted Cloud/GPU rendering, physical AMR accuracy, real broker operation and the LabVIEW command channel require separate verification. Synthetic model results remain software evidence.

Reproduce the checks using the [software-check guide](../../automated_software_checks/software_check_commands_and_coverage.md).

