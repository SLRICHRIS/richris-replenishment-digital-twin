"""Standalone Windows launcher for the authenticated local vision controller.

The agent refuses missing or unverified physical calibration; bundling it into
an executable never bypasses commissioning or enables motor movement.
"""
from backend_streamlit_and_telemetry.vision_control.desktop_agent import main

if __name__ == "__main__":
    main()
