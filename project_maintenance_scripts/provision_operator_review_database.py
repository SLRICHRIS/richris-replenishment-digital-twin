"""Add the intervention audit table; never modify physical sensor history."""
import os
from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase
from backend_streamlit_and_telemetry.predictive_twin.human_review import metadata


def main():
    store = SensorDatabase(os.environ.get('AMR_DATABASE_ADMIN_URL',''), initialize=False)
    try:
        store.assert_schema_ready()
        metadata.create_all(store.engine)
        print('AMR-01 operator review audit table ready. Apply restricted gateway and reader grants separately.')
    finally:
        store.engine.dispose()


if __name__ == '__main__':
    main()
