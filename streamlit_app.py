"""Streamlit Cloud entrypoint. Hosting implementation lives in backend_streamlit_and_telemetry/."""

from backend_streamlit_and_telemetry.streamlit_dashboard_host import render_dashboard


if __name__ == "__main__":
    render_dashboard()

