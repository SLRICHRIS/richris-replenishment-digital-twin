# Repository maintenance commands

Run commands from the repository root. These tools use Python's standard library.

| Command | Purpose |
| --- | --- |
| `python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py` | Rebuild ESP32/edge starter ZIPs and dashboard document copies from canonical sources |
| `python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py --check` | Check that committed downloads are current, without writing files |
| `python project_maintenance_scripts/record_and_verify_repository_file_hashes.py` | Record SHA-256 fingerprints for current repository files |
| `python project_maintenance_scripts/record_and_verify_repository_file_hashes.py --check` | Compare current files to the committed fingerprint record |

After edits, rebuild affected downloads, run the [relevant checks](../automated_software_checks/software_check_commands_and_coverage.md), update the [verification record](../project_documentation/software_check_results_and_source_history/current_software_check_results.md), then regenerate fingerprints. Local environments, caches and private settings are excluded from fingerprints and commits.
