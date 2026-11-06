"""Check an actual Streamlit process and every served digital twin application asset.

Run with the project's Python environment: python automated_software_checks/streamlit_and_repository_integration_checks/check_streamlit_frontend_file_delivery.py
This is a transport check, not a browser or WebGL rendering test.
"""

from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.request import ProxyHandler, build_opener

from streamlit.proto.BackMsg_pb2 import BackMsg
from streamlit.proto.ForwardMsg_pb2 import ForwardMsg
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://127.0.0.1:8511"
http = build_opener(ProxyHandler({}))


def check():
    with tempfile.TemporaryFile(mode="w+t") as log:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "streamlit",
                "run",
                "streamlit_app.py",
                "--server.address",
                "127.0.0.1",
                "--server.port",
                "8511",
            ],
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("Streamlit exited during startup")
                try:
                    with http.open(BASE + "/_stcore/health", timeout=0.3) as response:
                        assert response.status == 200
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Streamlit did not become ready within 10 seconds")

            with connect(
                "ws://127.0.0.1:8511/_stcore/stream",
                origin=BASE,
                subprotocols=["streamlit"],
                open_timeout=5,
                proxy=None,
            ) as websocket:
                request = BackMsg()
                request.rerun_script.query_string = ""
                websocket.send(request.SerializeToString())
                component = None
                python_title = None
                for _ in range(100):
                    message = ForwardMsg()
                    message.ParseFromString(websocket.recv(timeout=10))
                    kind = message.WhichOneof("type")
                    if kind == "delta" and message.delta.HasField("new_element"):
                        element = message.delta.new_element
                        if element.HasField("exception"):
                            raise AssertionError(element.exception.message)
                        if element.HasField("heading"):
                            if element.heading.tag == "h1":
                                python_title = element.heading.body
                        if element.HasField("component_instance"):
                            component = element.component_instance.component_name
                    if kind == "script_finished":
                        break
                assert component == "backend_streamlit_and_telemetry.streamlit_dashboard_host.replenish_workspace", component
                assert python_title is None, "The original warehouse is the default screen"

                count = 0
                assets = ROOT / "frontend_warehouse_dashboard"
                for path in sorted(assets.rglob("*")):
                    if not path.is_file() or "__pycache__" in path.parts:
                        continue
                    relative = path.relative_to(assets).as_posix()
                    with http.open(
                        BASE + "/component/" + component + "/" + relative, timeout=5
                    ) as response:
                        assert response.read() == path.read_bytes(), relative
                        mime = response.headers.get_content_type()
                        if path.suffix in (".js", ".mjs"):
                            assert mime in (
                                "application/javascript",
                                "text/javascript",
                            ), (relative, mime)
                        elif path.suffix == ".css":
                            assert mime == "text/css", (relative, mime)
                        elif path.suffix == ".html":
                            assert mime == "text/html", (relative, mime)
                        count += 1
                print(
                    f"PASS: actual Streamlit startup and WebSocket session; {count} warehouse application files served byte-for-byte with valid script/style/document MIME types."
                )
        except Exception:
            log.seek(0)
            print(log.read()[-3000:], file=sys.stderr)
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    check()
