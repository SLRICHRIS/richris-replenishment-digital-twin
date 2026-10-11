"""Host the browser dashboard as a local Streamlit component.

The browser owns simulation, routing and telemetry display. This host receives
only the component handshake and viewport size, not MQTT credentials or readings.
"""

from pathlib import Path

import streamlit as st
from streamlit.components.v1 import declare_component


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIRECTORY = REPOSITORY_ROOT / "frontend"
APPLICATION_VERSION = "2.1.0"


def render_dashboard() -> None:
    """Render the workspace with stable identity and an independently scrolling body."""
    st.set_page_config(
        page_title="Replenish | S L RICHRIS",
        page_icon=str(FRONTEND_DIRECTORY / "assets/warehouse_application_icon.svg"),
        layout="wide",
        initial_sidebar_state="collapsed",
        menu_items={
            "About": (
                f"Replenish {APPLICATION_VERSION}: an educational three-AMR digital twin. "
                "© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes."
            )
        },
    )
    st.html(
        """
        <style>
        [data-testid="stHeader"] { display: none; }
        [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: none !important; }
        [data-testid="stVerticalBlock"] { gap: 0; }
        [data-testid="stAppViewContainer"] { overflow-x: hidden; overflow-y: auto; }
        iframe[title*="replenish_workspace"] { display: block; width: 100%; border: 0; }
        </style>
        """
    )
    if not (FRONTEND_DIRECTORY / "index.html").is_file():
        st.error("The frontend/index.html file is missing. Deploy the complete repository.")
        st.stop()

    workspace = declare_component("replenish_workspace", path=str(FRONTEND_DIRECTORY))
    workspace(key="warehouse-workspace", default=None)
