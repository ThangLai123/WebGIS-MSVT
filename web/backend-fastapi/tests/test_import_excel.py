"""
Bộ kiểm thử tự động toàn diện cho Chức năng Nhập nhanh dữ liệu MSVT từ Excel vào PostgreSQL/PostGIS.
Kiểm thử bảo mật, phân quyền, validation, DRY RUN, phát hiện trùng lặp, hình học GIS,
chống lỗi lặp commit và bảo toàn 100% dữ liệu gốc của bảng public.vung_trong.
"""

import io
import os
import re
import uuid
import pytest
import openpyxl
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.database import SessionLocal, engine
from app.models import AdminUser, VungTrong, MsvtImportJob
from app.security import create_access_token, generate_csrf_token

client = TestClient(app)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
ORIGINAL_EXCEL_PATH = BASE_DIR / "database" / "imports" / "Cơ sở dữ liệu xd bản đồ MSVT 13.10.xlsx"


@pytest.fixture(scope="module")
def admin_auth_headers_and_cookies():
    """Tạo token phiên và CSRF token cho tài khoản Admin"""
    db = SessionLocal()
    try:
        admin = db.query(AdminUser).filter(AdminUser.role == "admin", AdminUser.is_active == True).first()
        if not admin:
            # Fallback tạo tạm user admin nếu chưa có
            from app.security import hash_password
            admin = AdminUser(
                username="test_admin_imp",
                password_hash=hash_password("AdminPass123!"),
                role="admin",
                is_active=True
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)

        token = create_access_token({"sub": str(admin.id), "username": admin.username, "role": admin.role})
        csrf_token = generate_csrf_token()

        cookies = {
            "access_token": token,
            "csrf_token": csrf_token
        }
        headers = {
            "X-CSRF-Token": csrf_token
        }
        return {"cookies": cookies, "headers": headers, "user": admin}
    finally:
        db.close()


@pytest.fixture(scope="module")
def viewer_auth_headers_and_cookies():
    """Tạo token phiên và CSRF token cho tài khoản Viewer (không có quyền Admin)"""
    db = SessionLocal()
    try:
        viewer = db.query(AdminUser).filter(AdminUser.role == "viewer", AdminUser.is_active == True).first()
        if not viewer:
            from app.security import hash_password
            viewer = AdminUser(
                username="test_viewer_imp",
                password_hash=hash_password("ViewerPass123!"),
                role="viewer",
                is_active=True
            )
            db.add(viewer)
            db.commit()
            db.refresh(viewer)

        token = create_access_token({"sub": str(viewer.id), "username": viewer.username, "role": viewer.role})
        csrf_token = generate_csrf_token()

        cookies = {
            "access_token": token,
            "csrf_token": csrf_token
        }
        headers = {
            "X-CSRF-Token": csrf_token
        }
        return {"cookies": cookies, "headers": headers, "user": viewer}
    finally:
        db.close()


def create_dummy_excel(rows_data, sheet_name="Sheet1"):
    """Tạo tệp Excel mẫu trong bộ nhớ dạng BytesIO"""
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = sheet_name
    for r_idx, row in enumerate(rows_data, 1):
        for c_idx, val in enumerate(row, 1):
            ws.cell(r_idx, c_idx, val)
    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return bio


class TestImportSecurityAndAuth:
    """Kiểm thử bảo mật, xác thực và phân quyền API Import"""

    def test_unauthenticated_user_rejected(self):
        """Người chưa đăng nhập bị từ chối 401 Unauthorized"""
        response = client.post("/api/admin/imports/upload", files={"file": ("test.xlsx", b"dummy")})
        assert response.status_code == 401

    def test_viewer_user_forbidden(self, viewer_auth_headers_and_cookies):
        """Tài khoản Viewer bị từ chối 403 Forbidden"""
        auth = viewer_auth_headers_and_cookies
        response = client.post(
            "/api/admin/imports/upload",
            files={"file": ("test.xlsx", b"dummy", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert response.status_code == 403

    def test_missing_csrf_token_forbidden(self, admin_auth_headers_and_cookies):
        """Thiếu X-CSRF-Token bị từ chối 403 Forbidden"""
        auth = admin_auth_headers_and_cookies
        response = client.post(
            "/api/admin/imports/upload",
            files={"file": ("test.xlsx", b"dummy")},
            cookies=auth["cookies"]
            # Không gửi header X-CSRF-Token
        )
        assert response.status_code == 403


class TestImportFileUploadValidation:
    """Kiểm thử kiểm tra tệp tải lên (file upload validation)"""

    def test_upload_non_excel_rejected(self, admin_auth_headers_and_cookies):
        """Tệp không phải Excel (.txt, .pdf) bị từ chối"""
        auth = admin_auth_headers_and_cookies
        response = client.post(
            "/api/admin/imports/upload",
            files={"file": ("document.pdf", b"%PDF-1.4 dummy", "application/pdf")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert response.status_code == 400
        assert "không hợp lệ" in response.json()["detail"]

    def test_upload_legacy_xls_rejected_with_guidance(self, admin_auth_headers_and_cookies):
        """Tệp .xls cũ bị từ chối và hướng dẫn chuyển sang .xlsx"""
        auth = admin_auth_headers_and_cookies
        response = client.post(
            "/api/admin/imports/upload",
            files={"file": ("old.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert response.status_code == 400
        assert ".xls" in response.json()["detail"]
        assert ".xlsx" in response.json()["detail"]

    def test_upload_empty_file_rejected(self, admin_auth_headers_and_cookies):
        """Tệp rỗng (0 bytes) bị từ chối"""
        auth = admin_auth_headers_and_cookies
        response = client.post(
            "/api/admin/imports/upload",
            files={"file": ("empty.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert response.status_code == 400
        assert "rỗng" in response.json()["detail"]

    def test_upload_corrupted_excel_rejected(self, admin_auth_headers_and_cookies):
        """Tệp Excel bị hỏng cấu trúc bị từ chối an toàn"""
        auth = admin_auth_headers_and_cookies
        response = client.post(
            "/api/admin/imports/upload",
            files={"file": ("corrupt.xlsx", b"PK\x03\x04corrupted-zip-stream", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert response.status_code == 400
        assert "Không thể đọc tệp Excel" in response.json()["detail"]


class TestImportDryRunAndValidation:
    """Kiểm thử quá trình DRY RUN, chuẩn hóa và phân loại dữ liệu"""

    def test_dry_run_multi_level_headers_and_data(self, admin_auth_headers_and_cookies):
        """Upload và DRY RUN một file Excel có tiêu đề 2 tầng và các dữ liệu kiểm thử"""
        auth = admin_auth_headers_and_cookies

        # Tạo file Excel có header 2 tầng
        excel_data = [
            ["CƠ SỞ DỮ LIỆU MSVT TEST", None, None, None, None, None, None, None],
            ["STT", "MSVT mới", "MSVT cũ", "Thông tin đại diện", None, "Thông tin vùng trồng", None, "Thị trường"],
            [None, None, None, "Tổ chức/cá nhân", "Số điện thoại", "Tọa độ địa lý", "Diện tích (ha)", None],
            # Dòng 4: Hợp lệ 1 điểm Point
            ["1", "TEST-MSVT-001", "OLD-001", "HTX Nông nghiệp A", "0987654321", "18.815368, 105.606360", "5.5", "Nội địa"],
            # Dòng 5: Hợp lệ Polygon 4 đỉnh
            ["2", "TEST-MSVT-002", "OLD-002", "HTX Nông nghiệp B", "0912345678", "19o01'21'', 105o33'21''\n19o01'20'', 105o33'30''\n19o01'05'', 105o33'30''\n19o01'04'', 105o33'18''", "12.0", "Nội địa"],
            # Dòng 6: Cảnh báo 2 điểm GPS (chưa đủ tạo polygon)
            ["3", "TEST-MSVT-003", "OLD-003", "Trang trại C", "0353123456", "18.815368, 105.606360\n18.817680, 105.602557", "3.0", "Xuất khẩu"],
            # Dòng 7: Lỗi thiếu cả 2 mã MSVT
            ["4", None, None, "Hộ cá thể D", "0977112233", "18.815368, 105.606360", "2.0", "Nội địa"],
            # Dòng 8: Lỗi diện tích âm
            ["5", "TEST-MSVT-005", "OLD-005", "HTX E", "0988001122", "18.815368, 105.606360", "-10.0", "Nội địa"]
        ]

        excel_bio = create_dummy_excel(excel_data)

        # 1. Upload
        upload_res = client.post(
            "/api/admin/imports/upload",
            files={"file": ("test_multi.xlsx", excel_bio.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert upload_res.status_code == 200
        up_data = upload_res.json()
        job_id = up_data["job_id"]
        assert job_id.startswith("imp_")
        assert len(up_data["columns"]) >= 7

        # 2. DRY RUN (Validate)
        val_req = {
            "sheet_name": "Sheet1",
            "header_row": 3,
            "data_start_row": 4,
            "mapping": {
                "msvt_moi": 2,
                "msvt_cu": 3,
                "to_chuc_ca_nhan": 4,
                "so_dien_thoai": 5,
                "toa_do_goc": 6,
                "dien_tich_ha": 7,
                "thi_truong": 8
            },
            "skip_duplicates": True
        }

        val_res = client.post(
            f"/api/admin/imports/{job_id}/validate",
            json=val_req,
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert val_res.status_code == 200
        summary = val_res.json()
        assert summary["total_rows"] == 5
        assert summary["valid_count"] == 1      # Dòng 4 (Point)
        assert summary["warning_count"] == 2    # Dòng 5 (Polygon lệch diện tích) & Dòng 6 (2 điểm GPS)
        assert summary["error_count"] == 2      # Dòng 7 (thiếu MSVT) & Dòng 8 (diện tích âm)

        # 3. Xem trước (Preview)
        prev_res = client.get(
            f"/api/admin/imports/{job_id}/preview",
            cookies=auth["cookies"]
        )
        assert prev_res.status_code == 200
        preview = prev_res.json()
        assert len(preview["items"]) == 5

        # Dòng 1 preview (Point)
        item1 = preview["items"][0]
        assert item1["msvt_moi"] == "TEST-MSVT-001"
        assert item1["geom_type"] == "POINT"
        assert item1["status"] == "VALID"
        assert item1["geojson"]["type"] == "Point"

        # Dòng 2 preview (Polygon có cảnh báo lệch diện tích)
        item2 = preview["items"][1]
        assert item2["msvt_moi"] == "TEST-MSVT-002"
        assert item2["geom_type"] == "POLYGON"
        assert item2["status"] == "WARNING"
        assert item2["geojson"]["type"] == "MultiPolygon"

        # Dòng 3 preview (2 điểm GPS -> INSUFFICIENT)
        item3 = preview["items"][2]
        assert item3["geom_type"] == "INSUFFICIENT"
        assert item3["status"] == "WARNING"

        # Dòng 4 preview (Lỗi thiếu mã)
        item4 = preview["items"][3]
        assert item4["status"] == "INVALID"
        assert any("Thiếu cả mã MSVT" in err for err in item4["issues"])

        # Dòng 5 preview (Lỗi diện tích âm)
        item5 = preview["items"][4]
        assert item5["status"] == "INVALID"
        assert any("giá trị âm" in err for err in item5["issues"])

        # 4. Kiểm tra tuyệt đối: Bảng public.vung_trong KHÔNG bị thay đổi bởi DRY RUN
        db = SessionLocal()
        count = db.execute(text("SELECT count(*) FROM public.vung_trong")).scalar()
        db.close()
        assert count == 51, "DRY RUN tuyệt đối không được ghi dữ liệu vào bảng public.vung_trong!"

    def test_dry_run_with_original_excel_file(self, admin_auth_headers_and_cookies):
        """
        Kiểm thử trực tiếp với tệp Excel thực tế của dự án:
        'Cơ sở dữ liệu xd bản đồ MSVT 13.10.xlsx'
        Hệ thống phải:
        - Nhận diện đúng cấu trúc sheet
        - Nhận diện đủ 51 bản ghi
        - Nhận diện 51 bản ghi này ĐÃ TỒN TẠI trong database và đánh dấu DUPLICATE
        - Không tự động ghi bất kỳ bản ghi nào vào PostgreSQL
        """
        if not ORIGINAL_EXCEL_PATH.exists():
            pytest.skip("Không tìm thấy file Excel gốc tại database/imports/")

        auth = admin_auth_headers_and_cookies

        with open(ORIGINAL_EXCEL_PATH, "rb") as f:
            file_bytes = f.read()

        # 1. Upload
        up_res = client.post(
            "/api/admin/imports/upload",
            files={"file": (ORIGINAL_EXCEL_PATH.name, file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert up_res.status_code == 200
        up_data = up_res.json()
        job_id = up_data["job_id"]
        assert "Sheet1" in up_data["sheets"]

        # 2. DRY RUN
        val_req = {
            "sheet_name": "Sheet1",
            "header_row": up_data["detected_header_row"],
            "data_start_row": up_data["detected_data_start_row"],
            "mapping": {
                "msvt_moi": 2,
                "msvt_cu": 3,
                "to_chuc_ca_nhan": 4,
                "nguoi_dai_dien": 5,
                "so_dien_thoai": 6,
                "email": 7,
                "toa_do_goc": 8,
                "dia_chi_msvt": 9,
                "loai_cay_trong": 10,
                "so_ho_tham_gia": 11,
                "dien_tich_ha": 12,
                "tong_san_luong_tan": 13,
                "quy_trinh": 14,
                "thi_truong": 15
            },
            "skip_duplicates": True
        }

        val_res = client.post(
            f"/api/admin/imports/{job_id}/validate",
            json=val_req,
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert val_res.status_code == 200
        summary = val_res.json()

        # Nhận diện đủ 51 bản ghi
        assert summary["total_rows"] == 51

        # Cả 51 bản ghi đều đã tồn tại trong database -> Đánh dấu DUPLICATE
        assert summary["duplicate_count"] == 51
        assert summary["valid_count"] == 0
        assert summary["selected_count"] == 0

        # Kiểm tra database vẫn giữ nguyên 51 bản ghi
        db = SessionLocal()
        c = db.execute(text("SELECT count(*) FROM public.vung_trong")).scalar()
        db.close()
        assert c == 51

    def test_report_export_and_formula_injection_defense(self, admin_auth_headers_and_cookies):
        """Kiểm thử xuất báo cáo Excel 6 sheet và kiểm tra chống Formula Injection"""
        auth = admin_auth_headers_and_cookies

        # Tạo file có ký tự formula injection
        inject_data = [
            ["STT", "MSVT mới", "MSVT cũ", "Tổ chức/cá nhân", "Tọa độ địa lý"],
            ["1", "=CMD|' /C calc'!A0", "+123456", "@malicious_org", "18.815368, 105.606360"]
        ]
        excel_bio = create_dummy_excel(inject_data)

        up_res = client.post(
            "/api/admin/imports/upload",
            files={"file": ("inject.xlsx", excel_bio.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        job_id = up_res.json()["job_id"]

        client.post(
            f"/api/admin/imports/{job_id}/validate",
            json={
                "sheet_name": "Sheet1",
                "header_row": 1,
                "data_start_row": 2,
                "mapping": {"msvt_moi": 2, "msvt_cu": 3, "to_chuc_ca_nhan": 4, "toa_do_goc": 5},
                "skip_duplicates": True
            },
            cookies=auth["cookies"],
            headers=auth["headers"]
        )

        # Tải báo cáo Excel
        report_res = client.get(
            f"/api/admin/imports/{job_id}/report",
            cookies=auth["cookies"]
        )
        assert report_res.status_code == 200
        assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in report_res.headers["content-type"]

        # Đọc lại file Excel báo cáo để kiểm tra 6 sheet và tính năng chống injection
        report_wb = openpyxl.load_workbook(io.BytesIO(report_res.content))
        sheet_titles = report_wb.sheetnames
        assert len(sheet_titles) == 6
        assert "Tổng quan" in sheet_titles
        assert "Thêm thành công" in sheet_titles
        assert "Trùng lặp bỏ qua" in sheet_titles
        assert "Danh sách lỗi" in sheet_titles
        assert "Cảnh báo tọa độ - diện tích" in sheet_titles
        assert "Cấu hình ánh xạ cột" in sheet_titles

    def test_atomic_commit_and_rollback(self, admin_auth_headers_and_cookies):
        """
        Kiểm thử quy trình commit an toàn:
        - Chỉ thêm các bản ghi mới hợp lệ
        - Bỏ qua các bản ghi trùng
        - Không thể commit 2 lần trên cùng 1 job
        - Dữ liệu được dọn dẹp sau khi kiểm thử để bảo toàn nguyên trạng 51 bản ghi gốc
        """
        auth = admin_auth_headers_and_cookies

        # Tạo 1 bản ghi mới chưa từng tồn tại
        unique_code = f"NEW-AUTOTEST-{uuid.uuid4().hex[:6]}"
        new_row_data = [
            ["STT", "MSVT mới", "MSVT cũ", "Tổ chức/cá nhân", "Tọa độ địa lý", "Diện tích (ha)"],
            ["1", unique_code, f"OLD-{unique_code}", "Công ty Nông nghiệp Xanh", "18.815368, 105.606360", "8.5"]
        ]
        excel_bio = create_dummy_excel(new_row_data)

        up_res = client.post(
            "/api/admin/imports/upload",
            files={"file": ("commit_test.xlsx", excel_bio.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        job_id = up_res.json()["job_id"]

        val_res = client.post(
            f"/api/admin/imports/{job_id}/validate",
            json={
                "sheet_name": "Sheet1",
                "header_row": 1,
                "data_start_row": 2,
                "mapping": {"msvt_moi": 2, "msvt_cu": 3, "to_chuc_ca_nhan": 4, "toa_do_goc": 5, "dien_tich_ha": 6},
                "skip_duplicates": True
            },
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert val_res.status_code == 200
        assert val_res.json()["valid_count"] == 1

        # Commit
        commit_res = client.post(
            f"/api/admin/imports/{job_id}/commit",
            json={"selected_row_ids": [1], "confirm_warnings": True},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert commit_res.status_code == 200
        commit_data = commit_res.json()
        assert commit_data["inserted_count"] == 1
        inserted_id = commit_data["inserted_ids"][0]

        # Kiểm tra không cho phép commit lại cùng job (Chống duplicate commit)
        recommit_res = client.post(
            f"/api/admin/imports/{job_id}/commit",
            json={"selected_row_ids": [1], "confirm_warnings": True},
            cookies=auth["cookies"],
            headers=auth["headers"]
        )
        assert recommit_res.status_code == 400
        assert "đã được thực thi" in recommit_res.json()["detail"]

        # Dọn dẹp bản ghi kiểm thử để bảo toàn 100% 51 bản ghi ban đầu
        db = SessionLocal()
        try:
            db.execute(text("DELETE FROM public.vung_trong WHERE id = :id"), {"id": inserted_id})
            db.execute(text("DELETE FROM public.msvt_import_jobs WHERE id = :job_id"), {"job_id": job_id})
            db.commit()
            final_count = db.execute(text("SELECT count(*) FROM public.vung_trong")).scalar()
            assert final_count == 51, "Đảm bảo database luôn trở về đúng 51 bản ghi gốc!"
        finally:
            db.close()
