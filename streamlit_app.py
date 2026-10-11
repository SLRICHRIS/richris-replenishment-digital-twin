"""Streamlit Cloud entrypoint. Hosting implementation lives in backend/."""

from backend.streamlit_dashboard_host import render_dashboard


if __name__ == "__main__":
    render_dashboard()

