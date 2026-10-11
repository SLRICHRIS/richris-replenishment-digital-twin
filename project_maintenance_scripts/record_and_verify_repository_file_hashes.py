"""Record or verify SHA-256 fingerprints of the current repository files."""
from argparse import ArgumentParser
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "project_documentation/software_check_results_and_source_history/current_repository_file_hashes_sha256.txt"
EXCLUDED_PARTS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".pytest_cache", "runtime", "migration_work"}
PRIVATE_NAMES = {"esp32_wifi_and_mqtt_settings.h", "robot_connection_settings.h", "mqtt_broker_private_settings.json", "config.json", "secrets.toml"}


def fingerprints() -> str:
    rows = []
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if not path.is_file() or path == MANIFEST or EXCLUDED_PARTS.intersection(relative.parts):
            continue
        if path.name in PRIVATE_NAMES or path.name.startswith(".env") or path.suffix in {".pyc", ".pyo", ".sqlite", ".sqlite3", ".db", ".pem", ".key"}:
            continue
        rows.append(hashlib.sha256(path.read_bytes()).hexdigest() + "  " + relative.as_posix())
    return "\n".join(rows) + "\n"


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    content = fingerprints()
    if parser.parse_args().check:
        if not MANIFEST.is_file() or MANIFEST.read_text(encoding="utf-8") != content:
            raise SystemExit("Repository fingerprints differ; regenerate after verification.")
        print(f"PASS: {len(content.splitlines())} repository SHA-256 fingerprints match.")
    else:
        MANIFEST.write_text(content, encoding="utf-8")
        print(f"Recorded {len(content.splitlines())} repository file fingerprints.")
