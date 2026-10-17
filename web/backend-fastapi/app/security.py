import secrets
from typing import Optional
from datetime import datetime, timedelta, timezone
import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from .config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

# ==============================================================================
# Cấu hình Argon2id Password Hasher (chuẩn OWASP)
# ==============================================================================
password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    type=Type.ID
)


def hash_password(password: str) -> str:
    """
    Băm mật khẩu an toàn bằng thuật toán Argon2id.
    Tuyệt đối không lưu trữ hoặc in mật khẩu plaintext.
    """
    if not password or not isinstance(password, str):
        raise ValueError("Mật khẩu không được để trống.")
    return password_hasher.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Kiểm tra mật khẩu plaintext đối chiếu với hash Argon2id đã lưu trữ.
    Bảo vệ chống timing attacks và lỗi băm.
    """
    if not plain_password or not hashed_password:
        return False
    try:
        return password_hasher.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except Exception:
        return False


# ==============================================================================
# JWT Session Token Helpers
# ==============================================================================
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Tạo JWT Access Token có thời hạn sử dụng và thuật toán ký bảo mật.
    """
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({
        "exp": expire,
        "iat": now
    })
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """
    Giải mã và xác thực chữ ký JWT Token. Trả về payload nếu hợp lệ, None nếu hết hạn/sai chữ ký.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


# ==============================================================================
# CSRF Token Protection (Double Submit Cookie Pattern)
# ==============================================================================
def generate_csrf_token() -> str:
    """Sinh chuỗi CSRF Token bảo mật ngẫu nhiên 32 bytes URL-safe"""
    return secrets.token_urlsafe(32)


def verify_csrf_token(header_token: Optional[str], cookie_token: Optional[str]) -> bool:
    """
    Kiểm tra tính khớp của CSRF token giữa HTTP Header và Cookie.
    Sử dụng secrets.compare_digest để ngăn chặn triệt để tấn công Timing Attack.
    """
    if not header_token or not cookie_token:
        return False
    return secrets.compare_digest(header_token, cookie_token)
