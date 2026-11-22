"""Launch the laptop ArUco route workspace and direct Wi-Fi controller.

The local service owns the USB camera and records operator approvals. Starting
the service never approves a route or commands physical movement.
"""
from backend_streamlit_and_telemetry.vision_control.local_twin import main


if __name__ == "__main__":
    main()
