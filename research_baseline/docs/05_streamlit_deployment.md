# 05. Deploy the research view with Streamlit Community Cloud

This repository already contains a separate legacy Streamlit application in its root. **Do not change that app's entrypoint.** The present model has its own file `research_baseline/streamlit_app.py`.

## Inputs when creating the Streamlit app

| Field | Value |
|---|---|
| GitHub repository | `SLRICHRIS/richris-replenishment-digital-twin` |
| Git branch | The branch with `research_baseline/`, or `main` after that change is merged |
| Entrypoint file | `research_baseline/streamlit_app.py` |
| Dependency file | `research_baseline/requirements.txt` |
| Python version | 3.12 |
| Secrets | None required for the synthetic Streamlit research view |

1. Ensure this research folder has been pushed to the indicated GitHub branch.
2. Open https://share.streamlit.io/ and choose **Create app**.
3. Connect/authorize the GitHub repository if prompted.
4. Use the exact branch and entrypoint from the table. Streamlit Community Cloud supports more than one app from a repository.
5. Deploy, inspect the build logs, then verify that `Warehouse Replenishment | Research Model` loads.
6. Try a new scenario, advance events and inspect conservation. Check that reloading or opening a new browser session resets the example state.
7. Do not claim successful deployment or circulate a URL until the new app is publicly accessible or the intended viewers have access.

**Platform constraint:** Streamlit Community Cloud runs the Streamlit Python process. It does not deploy the independent FastAPI server as a durable service, and the hosted example uses session-local state rather than production database persistence. If an authenticated, permanently running API is required, deploy the backend separately on an appropriate server with persistent storage and access controls.

Official references:
- https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/file-organization
- https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy
