import sys
from pathlib import Path

# Đảm bảo thư mục gốc backend-fastapi luôn nằm trong sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from app.main import app

__all__ = ["app"]
