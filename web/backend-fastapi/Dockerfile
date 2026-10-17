# ==============================================================================
# WebGIS MSVT - Backend FastAPI Dockerfile
# Multi-stage lightweight production container
# ==============================================================================

FROM python:3.12-slim

# Ngăn Python ghi file .pyc và bật unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Cài đặt thư viện hệ thống cần thiết cho Shapely/GEOS và psycopg
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgeos-c1v5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy và cài đặt dependencies Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy mã nguồn backend
COPY app/ ./app/
COPY run.py .
COPY create_admin.py .

# Tạo thư mục cho temporary imports
RUN mkdir -p temp_imports

# Tạo người dùng phi đặc quyền (non-root) để tăng cường bảo mật
RUN useradd -m -u 1000 webgisuser && \
    chown -R webgisuser:webgisuser /app

USER webgisuser

EXPOSE 8000

# Healthcheck định kỳ kiểm tra tình trạng sống của API
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/health || exit 1

CMD ["python", "run.py"]
