# Repository maintenance

Run `npm run format`, `npm run format:check`, and the [software checks](../automated_software_checks/software_check_commands_and_coverage.md). External browser libraries retain their upstream source and licenses.

Rebuild committed kits and browser guide copies after editing a source:

```sh
python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py
python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py --check
```

Update the single [verification record](../project_documentation/software_verification_results/current_software_check_results.md) with actual results and scope. Keep the [file-purpose catalog](../project_documentation/all_repository_file_purposes.md) aligned with current paths. Historical logs, hashes and rename maps belong in Git history.
