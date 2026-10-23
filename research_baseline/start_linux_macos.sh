#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-backend.txt
python -m uvicorn warehouse_twin.api:app --host 127.0.0.1 --port 8000
