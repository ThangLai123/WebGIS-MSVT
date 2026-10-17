#!/usr/bin/env python
"""
create_admin.py - Script CLI khởi tạo tài khoản quản trị viên (Admin) hoặc người xem (Viewer)
Dự án: WebGIS Quản lý Mã số Vùng trồng (MSVT)

Tính năng an toàn:
- Mật khẩu được nhập qua getpass, không echo ký tự ra màn hình.
- Tuyệt đối không hardcode mật khẩu và không in mật khẩu ra log.
- Mã hóa bằng thuật toán Argon2id chuẩn OWASP.
- Kiểm tra độ phức tạp mật khẩu tối thiểu.
"""

import sys
import getpass
import re
import argparse

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import SessionLocal
from app.models import AdminUser
from app.security import hash_password


def validate_password_strength(password: str) -> bool:
    """
    Kiểm tra độ phức tạp của mật khẩu quản trị:
    - Độ dài tối thiểu 8 ký tự
    - Chứa ít nhất một chữ hoa
    - Chứa ít nhất một chữ thường
    - Chứa ít nhất một chữ số
    """
    if len(password) < 8:
        print("[-] Lỗi: Mật khẩu phải có độ dài tối thiểu 8 ký tự.")
        return False
    if not re.search(r"[A-Z]", password):
        print("[-] Lỗi: Mật khẩu phải chứa ít nhất một chữ cái in hoa (A-Z).")
        return False
    if not re.search(r"[a-z]", password):
        print("[-] Lỗi: Mật khẩu phải chứa ít nhất một chữ cái in thường (a-z).")
        return False
    if not re.search(r"[0-9]", password):
        print("[-] Lỗi: Mật khẩu phải chứa ít nhất một chữ số (0-9).")
        return False
    return True


def create_or_update_user(username: str, password: str, role: str = "admin", is_active: bool = True):
    """Lưu hoặc cập nhật người dùng vào database với hash Argon2id an toàn"""
    db: Session = SessionLocal()
    try:
        # Băm mật khẩu bằng Argon2id
        pw_hash = hash_password(password)

        user = db.query(AdminUser).filter(AdminUser.username == username).first()
        if user:
            print(f"[*] Tài khoản '{username}' đã tồn tại trong CSDL. Đang tiến hành cập nhật...")
            user.password_hash = pw_hash
            user.role = role
            user.is_active = is_active
            user.failed_login_attempts = 0
            user.locked_until = None
            db.commit()
            print(f"[+] Đã cập nhật thành công mật khẩu và phân quyền cho tài khoản '{username}' (role={role}).")
        else:
            new_user = AdminUser(
                username=username,
                password_hash=pw_hash,
                role=role,
                is_active=is_active,
                failed_login_attempts=0,
                locked_until=None
            )
            db.add(new_user)
            db.commit()
            print(f"[+] Đã tạo mới thành công tài khoản '{username}' (role={role}, is_active={is_active}).")
    except Exception as e:
        db.rollback()
        print(f"[-] Lỗi khi lưu vào cơ sở dữ liệu: {e}")
        sys.exit(1)
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="CLI Khởi tạo tài khoản Quản trị viên WebGIS MSVT")
    parser.add_argument("--username", help="Tên đăng nhập (3-50 ký tự)", default=None)
    parser.add_argument("--role", choices=["admin", "viewer"], default="admin", help="Vai trò phân quyền (admin/viewer)")
    parser.add_argument("--password-stdin", action="store_true", help="Đọc mật khẩu từ stdin (cho tự động hóa kiểm thử)")
    args = parser.parse_args()

    print("=" * 65)
    print("   HỆ THỐNG WEBGIS MSVT - KHỞI TẠO TÀI KHOẢN QUẢN TRỊ VIÊN")
    print("=" * 65)

    # 1. Nhập username
    username = args.username
    if not username:
        while True:
            username_input = input("Nhập tên đăng nhập (username): ").strip()
            if not username_input:
                print("[-] Tên đăng nhập không được để trống.")
                continue
            if not re.match(r"^[a-zA-Z0-9_-]{3,50}$", username_input):
                print("[-] Tên đăng nhập chỉ gồm 3-50 ký tự chữ cái, số, gạch dưới hoặc gạch nối.")
                continue
            username = username_input
            break

    role = args.role

    # 2. Nhập mật khẩu an toàn
    if args.password_stdin:
        password = sys.stdin.readline().strip()
        if not validate_password_strength(password):
            sys.exit(1)
    else:
        while True:
            pw1 = getpass.getpass("Nhập mật khẩu (ẩn ký tự): ")
            if not validate_password_strength(pw1):
                continue
            pw2 = getpass.getpass("Xác nhận lại mật khẩu: ")
            if pw1 != pw2:
                print("[-] Lỗi: Hai lần nhập mật khẩu không khớp nhau. Vui lòng nhập lại.")
                continue
            password = pw1
            break

    # 3. Tạo tài khoản trong database
    create_or_update_user(username=username, password=password, role=role, is_active=True)


if __name__ == "__main__":
    main()
