# Generated dashboard downloads

The Hardware and Twin lab panels serve these files through the Streamlit component.
Edit canonical sources in `backend/`, `firmware/` or `docs/`, then rebuild:

```sh
python tools/build_dashboard_downloads.py
python tools/build_dashboard_downloads.py --check
```

The ZIP files preserve repository paths and contain example settings only. The ownership notice is copied from the repository root. The Markdown files are generated reading copies; their relative source links point to GitHub. They are not independent source files.

The builder checks archive contents, file order and timestamps reproducibly. Source-to-archive byte checks are also part of [integration verification](../../tests/README.md).
