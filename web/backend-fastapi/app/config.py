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
IS_VERCEL = bool(os.getenv("VERCEL")) or bool(os.getenv("AWS_LAMBDA_FUNCTION_NAME"))
ENVIRONMENT = os.getenv("ENVIRONMENT", "production" if IS_VERCEL else "development").lower()
IS_PRODUCTION = (ENVIRONMENT == "production") or IS_VERCEL

# Secret Key ký JWT (Token phiên) và CSRF Token
SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "webgis_msvt_super_secret_jwt_key_2026_change_in_production"
)
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 giờ

# Cấu hình Cookie an toàn
# Local HTTP development: COOKIE_SECURE=False để truyền được qua http://localhost:5173
# Production HTTPS (Vercel / Cloud): COOKIE_SECURE=True bắt buộc truyền qua HTTPS
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

# Cấu hình CORS linh hoạt (Hỗ trợ cả mảng JSON và chuỗi phân cách bởi dấu phẩy)
def get_cors_origins():
    origins_raw = os.getenv("CORS_ORIGINS")
    if not origins_raw or not origins_raw.strip():
        # Fallback cho local development
        return ["http://localhost:5173", "http://127.0.0.1:5173"]
    
    origins_raw = origins_raw.strip()
    # 1. Thử giải mã định dạng mảng JSON: ["https://fe.vercel.app"]
    try:
        parsed = json.loads(origins_raw)
        if isinstance(parsed, list):
            return [str(o).strip() for o in parsed if str(o).strip()]
    except Exception:
        pass
    
    # 2. Thử giải mã chuỗi phân cách bởi dấu phẩy: https://fe.vercel.app,https://example.com
    if "," in origins_raw:
        return [part.strip() for part in origins_raw.split(",") if part.strip()]
        
    return [origins_raw]

CORS_ORIGINS = get_cors_origins()
