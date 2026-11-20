"""Standalone Windows launcher for the existing attended camera setup tools.

Bundled by PyInstaller. This does not connect to MQTT or command the motors.
"""
from backend_streamlit_and_telemetry.vision_control.setup_camera import main

if __name__ == "__main__":
    main()
