"""Smoke-test a real LocalTwin process using GET requests on loopback only.

No browser, camera connection, route approval or ESP32 request is started.
The Windows workflow uses the packaged executable; --python-entry supports
the same check against source without requiring a Windows build.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise AssertionError("The loopback smoke test must not follow redirects")


def stop_process(process):
    if process.poll() is not None:
        return
    try:
        process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
        process.wait(timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def verify(command):
    # Refuse to inspect or interrupt an already-running operator workspace.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 8765))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(path):
        request = urllib.request.Request("http://127.0.0.1:8765" + path, method="GET")
        with opener.open(request, timeout=1) as response:
            assert response.status == 200, "Loopback endpoint did not return HTTP 200"
            body = response.read(2_000_001)
            assert len(body) <= 2_000_000, "Unexpectedly large loopback response"
            return response.headers, body

    environment = {k: v for k, v in os.environ.items() if not k.startswith("AMR_")}
    environment["AMR_DRIVE_KEY"] = "0" * 64  # Synthetic test-only key, never a device key.
    with tempfile.TemporaryDirectory(prefix="amr-http-smoke-") as directory:
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen(
                [*command, "--no-browser", "--state-dir", str(Path(directory) / "state")],
                cwd=directory, env=environment, stdin=subprocess.DEVNULL,
                stdout=output, stderr=output,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            try:
                deadline = time.monotonic() + 45
                while True:
                    assert process.poll() is None, "LocalTwin exited before serving its page"
                    try:
                        headers, body = get("/")
                        break
                    except (urllib.error.URLError, OSError):
                        if time.monotonic() >= deadline:
                            raise AssertionError("LocalTwin did not serve its loopback page within 45 seconds")
                        time.sleep(0.1)

                assert headers.get_content_type() == "text/html", "Expected the actual HTML workspace"
                assert headers.get_content_charset() == "utf-8", "HTML must declare UTF-8"
                html = body.decode("utf-8", errors="strict")
                for expected in ("AMR-01 · Local camera mission", "760 × 560 mm", '<strong id="battery-value">—</strong>'):
                    assert expected in html, "Packaged HTML lost an intended Unicode label or placeholder"
                assert "__AMR_SESSION_TOKEN__" not in html, "The live page was not rendered by LocalTwin"

                for _ in range(2):
                    headers, body = get("/api/status")
                    assert headers.get_content_type() == "application/json"
                    status = json.loads(body.decode("utf-8", errors="strict"))
                    assert status["connected"] is False, "Startup must not connect the controller"
                    assert status["ready"] is False, "Startup must not authorize movement"
                    assert status["camera"]["connected"] is False, "Startup must not open the camera"
                    assert status["camera"]["age_ms"] is None, "An unobserved camera has no frame age"
                    assert status["hardware"] is None, "Startup must not contact the ESP32"
                    assert status["agent"]["state"] == "idle", "Startup must not arm a route"
                    assert status["review"] is None, "The isolated workspace must not restore an approval"
                    time.sleep(0.1)
            finally:
                stop_process(process)
    print("PASS: real LocalTwin HTTP serves UTF-8 labels and remains disconnected before Connect.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--executable", type=Path)
    target.add_argument("--python-entry", type=Path)
    args = parser.parse_args()
    entry = (args.executable or args.python_entry).resolve(strict=True)
    verify([str(entry)] if args.executable else [sys.executable, str(entry)])


if __name__ == "__main__":
    main()
