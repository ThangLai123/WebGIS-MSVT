from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AdminUser
from ..config import (
    AUTH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    COOKIE_SECURE,
    COOKIE_SAMESITE,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    MAX_FAILED_ATTEMPTS,
    LOCKOUT_MINUTES
)
from ..security import (
    verify_password,
    create_access_token,
    generate_csrf_token
)
from ..schemas import (
    LoginRequest,
    LoginResponse,
    UserResponse,
    LogoutResponse,
    VerifyAdminResponse
)
from ..dependencies import (
    get_current_user,
    require_admin,
    require_csrf
)

router = APIRouter(prefix="/api/auth", tags=["Xác thực & Quản trị"])


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Đăng nhập tài khoản quản trị viên / người xem"
)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Xác thực đăng nhập người dùng:
    - Kiểm tra giới hạn số lần thử sai (chống Brute-force).
    - Khóa tài khoản tạm thời nếu vượt quá số lần cho phép.
    - So sánh hash mật khẩu bằng Argon2id.
    - Thiết lập Cookie HttpOnly (chống XSS) và CSRF Cookie.
    """
    now = datetime.now(timezone.utc)
    username = payload.username.strip()

    # Tìm kiếm người dùng theo username
    user = db.query(AdminUser).filter(AdminUser.username == username).first()

    # 1. Kiểm tra trạng thái khóa do thử sai quá giới hạn
    if user and user.locked_until:
        if user.locked_until > now:
            remaining_seconds = int((user.locked_until - now).total_seconds())
            remaining_minutes = max(1, remaining_seconds // 60)
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=f"Tài khoản đang bị tạm khóa do nhập sai mật khẩu quá {MAX_FAILED_ATTEMPTS} lần. "
                       f"Vui lòng thử lại sau {remaining_minutes} phút."
            )
        else:
            # Hết thời gian khóa, tự động mở khóa lại
            user.locked_until = None
            user.failed_login_attempts = 0
            db.commit()

    # 2. Kiểm tra mật khẩu bằng Argon2id
    is_valid_password = False
    if user:
        is_valid_password = verify_password(payload.password, user.password_hash)

    # 3. Xử lý khi mật khẩu sai hoặc tài khoản không tồn tại
    if not user or not is_valid_password:
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail=f"Đăng nhập thất bại {MAX_FAILED_ATTEMPTS} lần liên tiếp. "
                           f"Tài khoản đã bị tạm khóa trong {LOCKOUT_MINUTES} phút để đảm bảo an toàn."
                )
            else:
                db.commit()
                remaining = MAX_FAILED_ATTEMPTS - user.failed_login_attempts
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Tên đăng nhập hoặc mật khẩu không chính xác. Bạn còn {remaining} lần thử trước khi bị khóa."
                )
        else:
            # Tránh timing attack và lộ thông tin username tồn tại
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Tên đăng nhập hoặc mật khẩu không chính xác."
            )

    # 4. Kiểm tra trạng thái kích hoạt của tài khoản
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản này đã bị quản trị viên vô hiệu hóa. Không thể đăng nhập."
        )

    # 5. Đăng nhập thành công: Đặt lại bộ đếm thử sai và cập nhật thời gian
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    db.commit()

    # 6. Tạo JWT Session Token và CSRF Token
    token_payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role
    }
    access_token = create_access_token(token_payload)
    csrf_token = generate_csrf_token()

    # 7. Đặt Cookie bảo mật
    max_age_seconds = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    # Cookie Token phiên: HttpOnly để Javascript không thể đọc (ngăn chặn XSS đánh cắp token)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=access_token,
        max_age=max_age_seconds,
        expires=max_age_seconds,
        path="/",
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE
    )

    # Cookie CSRF: Cho phép frontend đọc để gửi kèm Header X-CSRF-Token cho các thao tác ghi
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        max_age=max_age_seconds,
        expires=max_age_seconds,
        path="/",
        httponly=False,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE
    )

    return LoginResponse(
        message="Đăng nhập thành công",
        user=UserResponse.model_validate(user),
        csrf_token=csrf_token
    )


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Lấy thông tin tài khoản đang đăng nhập"
)
def get_me(current_user: AdminUser = Depends(get_current_user)):
    """
    Trả về thông tin chi tiết người dùng từ phiên đăng nhập hiện tại.
    Tuyệt đối không để lộ chuỗi băm password_hash.
    """
    return UserResponse.model_validate(current_user)


@router.post(
    "/logout",
    response_model=LogoutResponse,
    summary="Đăng xuất và hủy bỏ phiên đăng nhập"
)
def logout(response: Response, current_user: AdminUser = Depends(get_current_user)):
    """
    Hủy phiên đăng nhập bằng cách xóa toàn bộ cookie xác thực và CSRF trên trình duyệt.
    """
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")
    return LogoutResponse(message="Đăng xuất thành công. Phiên làm việc đã kết thúc.")


@router.get(
    "/verify-admin",
    response_model=VerifyAdminResponse,
    summary="Kiểm tra phân quyền quản trị viên Admin"
)
def verify_admin(current_user: AdminUser = Depends(require_admin)):
    """
    Điểm kiểm tra phân quyền: Trả về 200 OK nếu là Admin, trả về 403 Forbidden nếu là Viewer.
    """
    return VerifyAdminResponse(
        status="authorized",
        role=current_user.role,
        username=current_user.username
    )
