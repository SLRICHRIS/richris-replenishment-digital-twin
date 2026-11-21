"""Rebuild the frozen AMR-01 studies offline and compare their recorded results."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent
STUDIES = {"battery_voltage": "study.py", "gyroscope": "gyro_study.py"}


def check_fingerprints():
    count = 0
    for line in (ROOT / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
        expected, relative = line.split("  ", 1)
        path = (ROOT / relative).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            raise ValueError(f"Invalid or missing manifest entry: {relative}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"File fingerprint changed: {relative}")
        count += 1
    manifest = json.loads((ROOT / "source_manifest.json").read_text(encoding="utf-8"))
    for source in manifest["packet_exports"]:
        raw = gzip.decompress((ROOT / source["repository_path"]).read_bytes())
        if len(raw) != source["uncompressed_bytes"]:
            raise ValueError(f"Source byte count changed: {source['repository_path']}")
        if hashlib.sha256(raw).hexdigest() != source["uncompressed_sha256"]:
            raise ValueError(f"Source identity changed: {source['repository_path']}")
    print(f"Verified {count} file fingerprints and both decompressed source identities.", flush=True)


def compare_json(expected, actual, path):
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or expected.keys() != actual.keys():
            raise AssertionError(f"JSON keys differ: {path}")
        for key in expected:
            compare_json(expected[key], actual[key], f"{path}.{key}")
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            raise AssertionError(f"JSON list differs: {path}")
        for index, (left, right) in enumerate(zip(expected, actual)):
            compare_json(left, right, f"{path}[{index}]")
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
        if not isinstance(actual, (int, float)) or not math.isclose(expected, actual, rel_tol=1e-9, abs_tol=1e-9):
            raise AssertionError(f"Numeric result differs: {path}: {expected!r} != {actual!r}")
    elif expected != actual:
        raise AssertionError(f"Result differs: {path}: {expected!r} != {actual!r}")


def compare_results(original, rebuilt):
    import pandas as pd

    count = 0
    for directory in ("dataset", "data", "evaluation", "model"):
        for expected in sorted((original / directory).glob("*")):
            if expected.suffix not in {".csv", ".json"}:
                continue
            relative = expected.relative_to(original)
            actual = rebuilt / relative
            if expected.suffix == ".json":
                compare_json(json.loads(expected.read_text()), json.loads(actual.read_text()), str(relative))
            else:
                left = pd.read_csv(expected, dtype={"boot_id": "string"}, low_memory=False)
                right = pd.read_csv(actual, dtype={"boot_id": "string"}, low_memory=False)
                pd.testing.assert_frame_equal(left, right, check_exact=False, rtol=1e-9, atol=1e-9, obj=str(relative))
            count += 1
    return count


def check_shared_source():
    import pandas as pd

    voltage = pd.read_csv(ROOT / "battery_voltage/dataset/physical_packets.csv.gz", dtype={"boot_id": "string"}, low_memory=False)
    gyro = pd.read_csv(ROOT / "gyroscope/data/AMR01_Gyro_Packets.csv.gz", dtype={"boot_id": "string"}, low_memory=False)
    key = ["robot_id", "boot_id", "seq"]
    left = voltage[list(gyro.columns)].sort_values(key).reset_index(drop=True)
    right = gyro.sort_values(key).reset_index(drop=True)
    pd.testing.assert_frame_equal(left, right, check_exact=False, rtol=1e-12, atol=1e-12)
    print(f"Verified the gyro projection against all {len(voltage):,} source packets.", flush=True)


def reproduce(names):
    check_shared_source()
    with tempfile.TemporaryDirectory(prefix="amr01-study-") as temporary:
        for name in names:
            original = ROOT / name
            rebuilt = Path(temporary) / name
            shutil.copytree(original, rebuilt, ignore=shutil.ignore_patterns("__pycache__", ".venv", ".venv-study"))
            # Remove generated outputs so the comparison cannot accidentally pass
            # by reading a copied result that the training script did not recreate.
            for directory in ("evaluation", "model"):
                shutil.rmtree(rebuilt / directory)
                (rebuilt / directory).mkdir()
            data_directory = "dataset" if name == "battery_voltage" else "data"
            dataset_name = "AMR01_Model_Dataset.csv" if name == "battery_voltage" else "AMR01_Gyro_Model_Dataset.csv"
            (rebuilt / data_directory / dataset_name).unlink()
            (rebuilt / data_directory / "boot_sessions.csv").unlink()
            print(f"\nRebuilding {name} in a temporary folder...", flush=True)
            subprocess.run([sys.executable, str(rebuilt / STUDIES[name])], cwd=rebuilt, check=True)
            if name == "gyroscope":
                subprocess.run([sys.executable, str(rebuilt / "verify_study.py")], cwd=rebuilt, check=True)
            count = compare_results(original, rebuilt)
            print(f"PASS: {name}; {count} dataset, model and evaluation files match (numeric tolerance 1e-9).", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", choices=["all", *STUDIES], default="all")
    parser.add_argument("--verify-only", action="store_true", help="Verify packaged hashes without retraining.")
    args = parser.parse_args()
    check_fingerprints()
    if not args.verify_only:
        reproduce(list(STUDIES) if args.study == "all" else [args.study])
    print("PASS: requested checks completed.", flush=True)


if __name__ == "__main__":
    main()
