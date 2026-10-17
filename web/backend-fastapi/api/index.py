"""
Vercel Serverless Function Entrypoint cho Backend FastAPI WebGIS MSVT.
Tệp này phục vụ việc triển khai backend-fastapi lên Vercel Serverless Functions.
Vercel tự động nhận diện biến 'app' (ASGI callable) để phục vụ các yêu cầu HTTP.
"""
import sys
from pathlib import Path

# Đảm bảo đường dẫn gốc backend-fastapi nằm trong sys.path để các module trong app/ import thông suốt
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.main import app

# Export app làm ASGI handler cho Vercel
__all__ = ["app"]
