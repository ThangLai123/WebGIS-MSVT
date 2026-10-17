"""
test_auth.py - Bộ kiểm thử tự động xác thực và phân quyền quản trị WebGIS MSVT
Kiểm thử toàn diện 6 yêu cầu:
1. Đăng nhập đúng (Admin & Viewer)
2. Đăng nhập sai (401 & đếm số lần thử)
3. Giới hạn brute-force và khóa tài khoản (423 Locked)
4. Tài khoản bị vô hiệu hóa (403 Forbidden)
5. Người chưa đăng nhập không truy cập được API quản trị (401 Unauthorized)
6. Viewer không có quyền admin (403 Forbidden)
7. Admin có quyền phù hợp (200 OK)
8. Không để lộ password_hash hay thông tin nhạy cảm
"""

import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.database import get_db, SessionLocal
from app.models import AdminUser
from app.security import hash_password
from app.config import AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_test_users():
    """Tạo người dùng mẫu phục vụ kiểm thử và dọn dẹp sau khi chạy"""
    db: Session = SessionLocal()
    try:
        # Xóa các user test cũ nếu có
        db.query(AdminUser).filter(AdminUser.username.in_([
            "test_admin_suite",
            "test_viewer_suite",
            "test_locked_suite",
            "test_inactive_suite"
        ])).delete(synchronize_session=False)
        db.commit()

        # 1. Admin hợp lệ
        admin_user = AdminUser(
            username="test_admin_suite",
            password_hash=hash_password("AdminPass@2026!"),
            role="admin",
            is_active=True,
            failed_login_attempts=0
        )

        # 2. Viewer hợp lệ
        viewer_user = AdminUser(
            username="test_viewer_suite",
            password_hash=hash_password("ViewerPass@2026!"),
            role="viewer",
            is_active=True,
            failed_login_attempts=0
        )

        # 3. User phục vụ test brute force
        brute_user = AdminUser(
            username="test_locked_suite",
            password_hash=hash_password("LockMePass@2026!"),
            role="admin",
            is_active=True,
            failed_login_attempts=0
        )

        # 4. User bị vô hiệu hóa
        inactive_user = AdminUser(
            username="test_inactive_suite",
            password_hash=hash_password("InactivePass@2026!"),
            role="viewer",
            is_active=False,
            failed_login_attempts=0
        )

        db.add_all([admin_user, viewer_user, brute_user, inactive_user])
        db.commit()

        yield {
            "admin_username": "test_admin_suite",
            "admin_password": "AdminPass@2026!",
            "viewer_username": "test_viewer_suite",
            "viewer_password": "ViewerPass@2026!",
            "brute_username": "test_locked_suite",
            "brute_password": "LockMePass@2026!",
            "inactive_username": "test_inactive_suite",
            "inactive_password": "InactivePass@2026!"
        }
    finally:
        # Dọn dẹp dữ liệu kiểm thử
        db.query(AdminUser).filter(AdminUser.username.in_([
            "test_admin_suite",
            "test_viewer_suite",
            "test_locked_suite",
            "test_inactive_suite"
        ])).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_1_login_success_admin(setup_test_users):
    """1. Đăng nhập đúng bằng tài khoản Admin"""
    data = setup_test_users
    response = client.post("/api/auth/login", json={
        "username": data["admin_username"],
        "password": data["admin_password"]
    })
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["message"] == "Đăng nhập thành công"
    assert res_data["user"]["username"] == data["admin_username"]
    assert res_data["user"]["role"] == "admin"
    assert "password_hash" not in res_data["user"]
    assert "csrf_token" in res_data

    # Kiểm tra Cookie HttpOnly đã được set
    cookies = response.cookies
    assert AUTH_COOKIE_NAME in cookies
    assert CSRF_COOKIE_NAME in cookies


def test_2_login_success_viewer(setup_test_users):
    """2. Đăng nhập đúng bằng tài khoản Viewer"""
    data = setup_test_users
    response = client.post("/api/auth/login", json={
        "username": data["viewer_username"],
        "password": data["viewer_password"]
    })
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["user"]["username"] == data["viewer_username"]
    assert res_data["user"]["role"] == "viewer"
    assert "password_hash" not in res_data["user"]


def test_3_login_wrong_password(setup_test_users):
    """3. Đăng nhập sai mật khẩu (trả về 401 và thông báo số lần còn lại)"""
    data = setup_test_users
    response = client.post("/api/auth/login", json={
        "username": data["admin_username"],
        "password": "WrongPassword@999"
    })
    assert response.status_code == 401
    assert "Tên đăng nhập hoặc mật khẩu không chính xác" in response.json()["detail"]


def test_4_brute_force_lockout(setup_test_users):
    """4. Kiểm tra giới hạn số lần thử sai và tự động khóa tài khoản (Brute-force lockout)"""
    data = setup_test_users
    username = data["brute_username"]

    # Thử sai liên tục cho đến ngưỡng MAX_FAILED_ATTEMPTS (5 lần)
    for i in range(1, MAX_FAILED_ATTEMPTS):
        resp = client.post("/api/auth/login", json={
            "username": username,
            "password": f"WrongAttempt{i}@123"
        })
        assert resp.status_code == 401

    # Lần thử sai thứ 5 (đạt ngưỡng) -> Bị khóa ngay lập tức với mã 423 Locked
    lock_resp = client.post("/api/auth/login", json={
        "username": username,
        "password": "WrongAttemptFinal@123"
    })
    assert lock_resp.status_code == 423
    assert f"khóa trong {LOCKOUT_MINUTES} phút" in lock_resp.json()["detail"]

    # Thử đăng nhập lại dù nhập ĐÚNG mật khẩu trong thời gian bị khóa -> Vẫn bị từ chối 423
    attempt_correct = client.post("/api/auth/login", json={
        "username": username,
        "password": data["brute_password"]
    })
    assert attempt_correct.status_code == 423
    assert "Tài khoản đang bị tạm khóa" in attempt_correct.json()["detail"]


def test_5_login_inactive_user(setup_test_users):
    """5. Đăng nhập tài khoản bị vô hiệu hóa (is_active = False) -> Trả về 403 Forbidden"""
    data = setup_test_users
    response = client.post("/api/auth/login", json={
        "username": data["inactive_username"],
        "password": data["inactive_password"]
    })
    assert response.status_code == 403
    assert "vô hiệu hóa" in response.json()["detail"]


def test_6_unauthenticated_access_admin_api():
    """6. Người chưa đăng nhập gọi API quản trị -> Trả về 401 Unauthorized"""
    # Không gửi cookie hay token nào
    unauth_client = TestClient(app)
    response = unauth_client.get("/api/auth/verify-admin")
    assert response.status_code == 401
    assert "Chưa đăng nhập" in response.json()["detail"]


def test_7_viewer_cannot_access_admin_api(setup_test_users):
    """7. Viewer đăng nhập hợp lệ nhưng KHÔNG CÓ QUYỀN admin -> Trả về 403 Forbidden"""
    data = setup_test_users
    viewer_client = TestClient(app)

    # Đăng nhập bằng tài khoản Viewer
    login_resp = viewer_client.post("/api/auth/login", json={
        "username": data["viewer_username"],
        "password": data["viewer_password"]
    })
    assert login_resp.status_code == 200

    # Gọi API yêu cầu quyền require_admin
    admin_resp = viewer_client.get("/api/auth/verify-admin")
    assert admin_resp.status_code == 403
    assert "yêu cầu quyền Quản trị viên (Admin)" in admin_resp.json()["detail"]


def test_8_admin_can_access_admin_api(setup_test_users):
    """8. Admin đăng nhập hợp lệ -> Truy cập thành công API quản trị (200 OK)"""
    data = setup_test_users
    admin_client = TestClient(app)

    # Đăng nhập bằng tài khoản Admin
    login_resp = admin_client.post("/api/auth/login", json={
        "username": data["admin_username"],
        "password": data["admin_password"]
    })
    assert login_resp.status_code == 200

    # Gọi API yêu cầu quyền require_admin
    admin_resp = admin_client.get("/api/auth/verify-admin")
    assert admin_resp.status_code == 200
    res_data = admin_resp.json()
    assert res_data["status"] == "authorized"
    assert res_data["role"] == "admin"
    assert res_data["username"] == data["admin_username"]


def test_9_get_me_profile(setup_test_users):
    """9. Gọi /api/auth/me trả về đúng thông tin cá nhân, không lộ password_hash"""
    data = setup_test_users
    admin_client = TestClient(app)

    admin_client.post("/api/auth/login", json={
        "username": data["admin_username"],
        "password": data["admin_password"]
    })

    me_resp = admin_client.get("/api/auth/me")
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["username"] == data["admin_username"]
    assert me_data["role"] == "admin"
    assert me_data["is_active"] is True
    assert "password_hash" not in me_data


def test_10_logout_clears_session(setup_test_users):
    """10. Đăng xuất xóa bỏ cookie phiên, truy cập lại bị 401 Unauthorized"""
    data = setup_test_users
    admin_client = TestClient(app)

    # Đăng nhập
    admin_client.post("/api/auth/login", json={
        "username": data["admin_username"],
        "password": data["admin_password"]
    })

    # Xác nhận trước khi đăng xuất gọi được API
    pre_resp = admin_client.get("/api/auth/verify-admin")
    assert pre_resp.status_code == 200

    # Đăng xuất
    logout_resp = admin_client.post("/api/auth/logout")
    assert logout_resp.status_code == 200
    assert logout_resp.json()["message"] == "Đăng xuất thành công. Phiên làm việc đã kết thúc."

    # Gọi lại API sau khi đăng xuất -> Bị từ chối 401
    post_resp = admin_client.get("/api/auth/verify-admin")
    assert post_resp.status_code == 401
