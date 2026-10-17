import os
import json
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
LOCAL_ENV = BASE_DIR / ".env"
ROOT_ENV = BASE_DIR.parent / ".env"

if LOCAL_ENV.exists():
    load_dotenv(LOCAL_ENV)
elif ROOT_ENV.exists():
    load_dotenv(ROOT_ENV)

# ==============================================================================
# Môi trường chạy và bảo mật ứng dụng
# ==============================================================================
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"

# Secret Key ký JWT (Token phiên) và CSRF Token
SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "webgis_msvt_super_secret_jwt_key_2026_change_in_production"
)
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 giờ

# Cấu hình Cookie an toàn
# Local HTTP development: COOKIE_SECURE=False để truyền được qua http://localhost:5173
# Production HTTPS: COOKIE_SECURE=True bắt buộc truyền qua HTTPS
COOKIE_SECURE_ENV = os.getenv("COOKIE_SECURE")
if COOKIE_SECURE_ENV is not None:
    COOKIE_SECURE = COOKIE_SECURE_ENV.strip().lower() in ("true", "1", "yes")
else:
    COOKIE_SECURE = IS_PRODUCTION

from typing import Literal

raw_samesite = os.getenv("COOKIE_SAMESITE", "lax").lower()
COOKIE_SAMESITE: Literal["lax", "strict", "none"] = raw_samesite if raw_samesite in ("lax", "strict", "none") else "lax"
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "access_token")
CSRF_COOKIE_NAME = os.getenv("CSRF_COOKIE_NAME", "csrf_token")

# Phòng chống Brute-Force đăng nhập
MAX_FAILED_ATTEMPTS = int(os.getenv("MAX_FAILED_ATTEMPTS", "5"))
LOCKOUT_MINUTES = int(os.getenv("LOCKOUT_MINUTES", "15"))

# Cấu hình CORS
def get_cors_origins():
    origins_raw = os.getenv("CORS_ORIGINS", '["http://localhost:5173", "http://127.0.0.1:5173"]')
    try:
        parsed = json.loads(origins_raw)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass
    return ["http://localhost:5173", "http://127.0.0.1:5173"]

CORS_ORIGINS = get_cors_origins()
