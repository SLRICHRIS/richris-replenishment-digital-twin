# Repository maintenance commands

Run commands from the repository root. These tools use Python's standard library.

| Command | Purpose |
| --- | --- |
| `python tools/build_dashboard_downloads.py` | Rebuild ESP32/edge starter ZIPs and dashboard document copies from canonical sources |
| `python tools/build_dashboard_downloads.py --check` | Check that committed downloads are current, without writing files |
| `python tools/record_repository_integrity.py` | Record SHA-256 fingerprints for current repository files |
| `python tools/record_repository_integrity.py --check` | Compare current files to the committed fingerprint record |

After edits, rebuild affected downloads, run the [relevant checks](../tests/README.md), update the [verification record](../docs/verification/README.md), then regenerate fingerprints. Local environments, caches and private settings are excluded from fingerprints and commits.
