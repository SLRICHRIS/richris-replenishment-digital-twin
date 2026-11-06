"""Host the browser dashboard as a local Streamlit component.

The active sensor twin runs models in Python. The optional legacy reference
workspace retains the earlier browser simulation for comparison.
"""

from pathlib import Path

import streamlit as st
from streamlit.components.v1 import declare_component

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIRECTORY = REPOSITORY_ROOT / "frontend_warehouse_dashboard"
APPLICATION_VERSION = "3.0.0"
LEGACY_WORKSPACE = declare_component("replenish_workspace", path=str(FRONTEND_DIRECTORY))


def render_dashboard() -> None:
    """Render the workspace with stable identity and an independently scrolling body."""
    st.set_page_config(
        page_title="Replenish | S L RICHRIS",
        page_icon=str(
            FRONTEND_DIRECTORY
            / "dashboard_images_and_fonts/warehouse_dashboard_application_icon.svg"
        ),
        layout="wide",
        initial_sidebar_state="expanded",
        menu_items={
            "About": (
                f"Replenish {APPLICATION_VERSION}: an educational two-robot sensor twin with a legacy warehouse reference. "
                "© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes."
            )
        },
    )
    view = st.sidebar.radio("Workspace", ("Two-robot Python twin", "Legacy 3D reference"))
    if view == "Two-robot Python twin":
        from .predictive_twin.dashboard import render_sensor_dashboard
        render_sensor_dashboard()
        return
    st.warning("Legacy reference: three virtual AMRs and browser-owned models. This workspace does not use the new Python sensor state; its connections and controls are separate.")
    if not (FRONTEND_DIRECTORY / "index.html").is_file():
        st.error(
            "The frontend_warehouse_dashboard/index.html file is missing. Deploy the complete repository."
        )
        st.stop()

    LEGACY_WORKSPACE(key="warehouse-workspace", default=None)
