from typing import Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from .models import AdminUser
from .config import AUTH_COOKIE_NAME, CSRF_COOKIE_NAME
from .security import decode_access_token, verify_csrf_token

# Hỗ trợ tùy chọn trích xuất Bearer token từ header cho test suite hoặc công cụ API
http_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    bearer_creds: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer_scheme),
    db: Session = Depends(get_db)
) -> AdminUser:
    """
    Dependency trích xuất và xác thực người dùng hiện tại:
    1. Ưu tiên đọc Token từ HttpOnly Cookie (chuẩn bảo mật trình duyệt).
    2. Fallback đọc Token từ header Authorization: Bearer <token> (cho tests/scripts).
    3. Giải mã JWT và kiểm tra tính toàn vẹn.
    4. Kiểm tra trạng thái hoạt động của tài khoản trong database.
    """
    token = None

    # 1. Kiểm tra Cookie
    if AUTH_COOKIE_NAME in request.cookies:
        token = request.cookies[AUTH_COOKIE_NAME]

    # 2. Fallback sang Authorization header nếu không có cookie
    if not token and bearer_creds:
        token = bearer_creds.credentials

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # 3. Giải mã JWT
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    user_id_raw = payload.get("sub")
    if not user_id_raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token không chứa định danh người dùng.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    try:
        user_id = int(user_id_raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Định danh người dùng không hợp lệ.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # 4. Truy vấn database
    user = db.query(AdminUser).filter(AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tài khoản người dùng không tồn tại.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên."
        )

    return user


def require_active_user(current_user: AdminUser = Depends(get_current_user)) -> AdminUser:
    """Dependency đảm bảo người dùng đã đăng nhập và đang ở trạng thái kích hoạt"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị khóa hoặc ngừng kích hoạt."
        )
    return current_user


def require_admin(current_user: AdminUser = Depends(require_active_user)) -> AdminUser:
    """
    Dependency phân quyền mức Admin:
    - Admin: cho phép tiếp tục thực thi.
    - Viewer hoặc vai trò khác: trả về 403 Forbidden.
    Sẽ được tái sử dụng trực tiếp cho các router CRUD thêm/sửa/xóa MSVT ở các bước sau.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Quyền truy cập bị từ chối. Thao tác này yêu cầu quyền Quản trị viên (Admin)."
        )
    return current_user


def require_csrf(request: Request) -> None:
    """
    Dependency bảo vệ chống tấn công CSRF cho các phương thức thay đổi trạng thái (POST, PUT, DELETE, PATCH).
    Chỉ áp dụng khi người dùng xác thực qua Cookie.
    So sánh giá trị header X-CSRF-Token với cookie csrf_token.
    """
    # Nếu xác thực qua Bearer header (không dùng cookie), rủi ro CSRF không tồn tại
    if AUTH_COOKIE_NAME not in request.cookies:
        return

    csrf_header = request.headers.get("X-CSRF-Token")
    csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)

    if not verify_csrf_token(csrf_header, csrf_cookie):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token không hợp lệ hoặc bị thiếu. Thao tác bị từ chối."
        )
