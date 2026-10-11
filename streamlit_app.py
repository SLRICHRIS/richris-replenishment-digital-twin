"""Streamlit host for the audited Replenish v2.1.0 three-AMR digital twin.

The front end remains a self-contained browser application. Streamlit serves
the component and its assets; it does not run the robot simulation each frame.
"""

from pathlib import Path

import streamlit as st
from streamlit.components.v1 import declare_component


ROOT = Path(__file__).resolve().parent
APPLICATION_FOLDER = ROOT / "digital_twin_application"
APPLICATION_VERSION = "2.1.0"
# Audited Site source: e8dbe22a7ef06e7016f2a2bf35251a4086f910be.

st.set_page_config(
    page_title="Replenish | S L RICHRIS",
    page_icon=str(APPLICATION_FOLDER / "application_icon.svg"),
    layout="wide",
    initial_sidebar_state="collapsed",
    menu_items={
        "About": (
            f"Replenish {APPLICATION_VERSION}: an educational three-AMR digital twin. "
            "© 2026 S L RICHRIS. All rights reserved. "
            "Purely for educational purposes."
        )
    },
)

# The workspace supplies its own responsive navigation and appearance controls.
# Keep all application styling inside the component's document.
st.html(
    """
    <style>
      [data-testid="stHeader"] { display: none; }
      [data-testid="stMainBlockContainer"] {
        padding: 0 !important;
        max-width: none !important;
      }
      [data-testid="stVerticalBlock"] { gap: 0; }
      [data-testid="stAppViewContainer"] { overflow: hidden; }
      iframe[title*="replenish_workspace"] {
        display: block;
        width: 100%;
        border: 0;
      }
    </style>
    """
)

if not (APPLICATION_FOLDER / "index.html").is_file():
    st.error("The digital_twin_application folder is missing. Upload the complete project, including that folder.")
    st.stop()

# A local component serves HTML, module scripts, workers, fonts, firmware
# downloads and license notices from this repository. No remote iframe or
# ChatGPT session is required. The stable key preserves the browser workspace
# during ordinary Streamlit reruns.
workspace = declare_component("replenish_workspace", path=str(APPLICATION_FOLDER))
workspace(key="warehouse-workspace", default=None)

