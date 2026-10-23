FROM python:3.12-slim
WORKDIR /app
COPY requirements-backend.txt /app/
RUN pip install --no-cache-dir -r requirements-backend.txt
COPY warehouse_twin /app/warehouse_twin
COPY web /app/web
EXPOSE 8000
CMD ["uvicorn","warehouse_twin.api:app","--host","0.0.0.0","--port","8000"]
