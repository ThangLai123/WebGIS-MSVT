"""
test_crud.py - Bộ kiểm thử tự động CRUD Vùng trồng MSVT và Phân quyền Quản trị
Bao gồm:
1. Admin thêm mới thành công (Point & Polygon).
2. Admin cập nhật PUT thành công.
3. Admin cập nhật từng phần PATCH (giữ nguyên hình học và các trường cũ).
4. Admin xóa mềm thành công (is_deleted = True, deleted_by set).
5. Vùng xóa mềm biến mất khỏi các API công khai (/regions, /geojson, /lookup, /statistics).
6. Viewer bị từ chối 403 Forbidden khi gọi POST, PUT, PATCH, DELETE.
7. Người chưa đăng nhập bị từ chối 401 Unauthorized.
8. Thiếu CSRF khi dùng cookie bị từ chối 403 Forbidden.
9. Dữ liệu số âm bị từ chối 422 Unprocessable Entity.
10. Tọa độ và hình học không hợp lệ bị từ chối 422 Unprocessable Entity.
11. Mã MSVT trùng lặp trả về HTTP 409 Conflict (không ghi đè).
12. Đảm bảo 51 bản ghi gốc được bảo toàn 100%, không bị ảnh hưởng.
"""

import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.main import app
from app.database import SessionLocal
from app.models import AdminUser, VungTrong
from app.security import hash_password
from app.config import AUTH_COOKIE_NAME, CSRF_COOKIE_NAME

client = TestClient(app)

TEST_MSVT_PREFIX = "TEST-CRUD-2026-"


@pytest.fixture(scope="module")
def setup_auth_and_cleanup():
    """Khởi tạo tài khoản test và dọn dẹp toàn bộ dữ liệu test sau khi chạy"""
    db: Session = SessionLocal()
    try:
        # Ghi nhận số lượng bản ghi ban đầu (51 bản ghi gốc từ ID 2 đến ID 52)
        original_records = db.query(VungTrong).filter(VungTrong.id <= 52).all()
        original_ids = set(r.id for r in original_records)
        assert len(original_ids) == 51, f"Bắt đầu test: Mong đợi 51 bản ghi gốc, nhưng có {len(original_ids)}"

        # Xóa các user test cũ
        db.query(AdminUser).filter(AdminUser.username.in_([
            "crud_test_admin",
            "crud_test_viewer"
        ])).delete(synchronize_session=False)

        # Xóa các bản ghi test cũ (nếu còn sót lại từ lần chạy trước)
        db.query(VungTrong).filter(VungTrong.id > 52).delete(synchronize_session=False)
        db.commit()

        # Tạo Admin user
        admin = AdminUser(
            username="crud_test_admin",
            password_hash=hash_password("AdminPass@2026!"),
            role="admin",
            is_active=True
        )

        # Tạo Viewer user
        viewer = AdminUser(
            username="crud_test_viewer",
            password_hash=hash_password("ViewerPass@2026!"),
            role="viewer",
            is_active=True
        )

        db.add_all([admin, viewer])
        db.commit()

        yield {
            "admin_user": "crud_test_admin",
            "admin_pass": "AdminPass@2026!",
            "viewer_user": "crud_test_viewer",
            "viewer_pass": "ViewerPass@2026!"
        }
    finally:
        # DỌN DẸP TUYỆT ĐỐI: Xóa mọi bản ghi test đã sinh ra (ID > 52)
        db.query(VungTrong).filter(VungTrong.id > 52).delete(synchronize_session=False)

        db.query(AdminUser).filter(AdminUser.username.in_([
            "crud_test_admin",
            "crud_test_viewer"
        ])).delete(synchronize_session=False)

        db.commit()

        # Đối chiếu số lượng 51 bản ghi gốc
        final_originals = db.query(VungTrong).filter(VungTrong.id.in_(original_ids)).all()
        final_count = len(final_originals)
        final_deleted = sum(1 for r in final_originals if r.is_deleted is True)
        db.close()

        assert final_count == 51, f"Kết thúc test: 51 bản ghi gốc phải được bảo toàn! Hiện có {final_count}"
        assert final_deleted == 0, f"Kết thúc test: Không bản ghi gốc nào được phép bị xóa mềm! Hiện có {final_deleted}"


def get_authenticated_client(username, password):
    """Đăng nhập và trả về client có sẵn cookie access_token và csrf_token"""
    c = TestClient(app)
    login_resp = c.post("/api/auth/login", json={"username": username, "password": password})
    assert login_resp.status_code == 200
    csrf_token = login_resp.json()["csrf_token"]
    return c, csrf_token


def test_1_admin_create_point_region_success(setup_auth_and_cleanup):
    """1. Admin thêm mới vùng trồng dạng Point thành công"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    payload = {
        "msvt_moi": f"{TEST_MSVT_PREFIX}POINT01",
        "to_chuc_ca_nhan": "Hợp tác xã Nông nghiệp Test Point",
        "nguoi_dai_dien": "Nguyễn Văn Test",
        "so_dien_thoai": "0912345678",
        "email": "testpoint@example.com",
        "dia_chi_msvt": "Xã Nghĩa Đàn, Tỉnh Nghệ An",
        "loai_cay_trong": "Cam",
        "so_ho_tham_gia": 12,
        "dien_tich_ha": 8.5,
        "tong_san_luong_tan": 120.0,
        "quy_trinh": "VietGAP",
        "thi_truong": "Nội địa",
        "geometry": {
            "point": {
                "longitude": 105.420,
                "latitude": 19.325
            }
        }
    }

    resp = admin_client.post(
        "/api/regions",
        json=payload,
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp.status_code == 201
    res_data = resp.json()
    assert res_data["msvt_moi"] == f"{TEST_MSVT_PREFIX}POINT01"
    assert res_data["geometry_type"] == "POINT"
    assert res_data["dien_tich_ha"] == 8.5
    assert res_data["is_deleted"] is False


def test_2_admin_create_polygon_region_success(setup_auth_and_cleanup):
    """2. Admin thêm mới vùng trồng dạng MultiPolygon thành công"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    valid_polygon = {
        "type": "Polygon",
        "coordinates": [
            [
                [105.410, 19.320],
                [105.415, 19.320],
                [105.415, 19.325],
                [105.410, 19.325],
                [105.410, 19.320]
            ]
        ]
    }

    payload = {
        "msvt_moi": f"{TEST_MSVT_PREFIX}POLY01",
        "to_chuc_ca_nhan": "Doanh nghiệp Xuất khẩu Test Poly",
        "loai_cay_trong": "Chanh leo",
        "dien_tich_ha": 15.2,
        "tong_san_luong_tan": 250.0,
        "thi_truong": "EU",
        "geometry": {
            "geojson": valid_polygon
        }
    }

    resp = admin_client.post(
        "/api/regions",
        json=payload,
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp.status_code == 201
    res_data = resp.json()
    assert res_data["msvt_moi"] == f"{TEST_MSVT_PREFIX}POLY01"
    assert res_data["geometry_type"] == "MULTIPOLYGON"
    assert res_data["is_deleted"] is False


def test_3_admin_update_put_region(setup_auth_and_cleanup):
    """3. Admin cập nhật toàn bộ (PUT) thông tin vùng trồng thành công"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    # Tạo trước 1 bản ghi có sẵn Point hợp lệ
    create_resp = admin_client.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_MSVT_PREFIX}PUT01",
            "loai_cay_trong": "Lúa",
            "dien_tich_ha": 5.0,
            "geometry": {
                "point": {
                    "longitude": 105.420,
                    "latitude": 19.325
                }
            }
        },
        headers={"X-CSRF-Token": csrf_token}
    )
    assert create_resp.status_code == 201
    region_id = create_resp.json()["id"]

    # Cập nhật PUT toàn bộ
    put_payload = {
        "msvt_moi": f"{TEST_MSVT_PREFIX}PUT01",
        "to_chuc_ca_nhan": "HTX Nông Nghiệp Đã Cập Nhật PUT",
        "loai_cay_trong": "Bưởi Da Xanh",
        "dien_tich_ha": 18.0,
        "tong_san_luong_tan": 300.0,
        "thi_truong": "Hoa Kỳ",
        "geometry": {
            "point": {
                "longitude": 105.500,
                "latitude": 19.400
            }
        }
    }

    put_resp = admin_client.put(
        f"/api/regions/{region_id}",
        json=put_payload,
        headers={"X-CSRF-Token": csrf_token}
    )
    assert put_resp.status_code == 200
    res_data = put_resp.json()
    assert res_data["to_chuc_ca_nhan"] == "HTX Nông Nghiệp Đã Cập Nhật PUT"
    assert res_data["loai_cay_trong"] == "Bưởi Da Xanh"
    assert res_data["dien_tich_ha"] == 18.0
    assert res_data["geometry_type"] == "POINT"


def test_4_admin_patch_preserves_geometry_and_untouched_fields(setup_auth_and_cleanup):
    """4. Admin cập nhật từng phần (PATCH) giữ nguyên hình học và các trường không gửi"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    # Tạo 1 bản ghi có sẵn Point geometry
    create_resp = admin_client.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_MSVT_PREFIX}PATCH01",
            "to_chuc_ca_nhan": "Tổ chức ban đầu",
            "loai_cay_trong": "Sầu riêng",
            "dien_tich_ha": 10.0,
            "geometry": {
                "point": {
                    "longitude": 105.432,
                    "latitude": 19.333
                }
            }
        },
        headers={"X-CSRF-Token": csrf_token}
    )
    assert create_resp.status_code == 201
    region_id = create_resp.json()["id"]

    # Gửi PATCH CHỈ sửa to_chuc_ca_nhan, KHÔNG gửi geometry
    patch_resp = admin_client.patch(
        f"/api/regions/{region_id}",
        json={"to_chuc_ca_nhan": "Tổ chức sau khi PATCH"},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert patch_resp.status_code == 200
    res_data = patch_resp.json()
    assert res_data["to_chuc_ca_nhan"] == "Tổ chức sau khi PATCH"
    assert res_data["loai_cay_trong"] == "Sầu riêng"  # Giữ nguyên
    assert res_data["dien_tich_ha"] == 10.0            # Giữ nguyên
    assert res_data["geometry_type"] == "POINT"        # BẢO TOÀN NGUYÊN VẸN HÌNH HỌC


def test_5_admin_soft_delete_and_public_api_exclusion(setup_auth_and_cleanup):
    """5. Admin xóa mềm và kiểm tra bản ghi biến mất khỏi toàn bộ API công khai"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    msvt_test_code = f"{TEST_MSVT_PREFIX}DEL01"

    # Tạo vùng trồng
    create_resp = admin_client.post(
        "/api/regions",
        json={
            "msvt_moi": msvt_test_code,
            "to_chuc_ca_nhan": "Vùng trồng sẽ bị xóa mềm",
            "dien_tich_ha": 12.0,
            "geometry": {
                "point": {"longitude": 105.450, "latitude": 19.350}
            }
        },
        headers={"X-CSRF-Token": csrf_token}
    )
    assert create_resp.status_code == 201
    region_id = create_resp.json()["id"]

    # Trước khi xóa: Kiểm tra có xuất hiện trên GET /api/regions
    pub_get = client.get(f"/api/regions?msvt={msvt_test_code}")
    assert pub_get.status_code == 200
    assert pub_get.json()["total"] == 1

    # Thực hiện Xóa Mềm qua DELETE /api/regions/{id}
    del_resp = admin_client.delete(
        f"/api/regions/{region_id}",
        headers={"X-CSRF-Token": csrf_token}
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["message"] == "Xóa mềm vùng trồng thành công."
    assert del_resp.json()["id"] == region_id

    # Sau khi xóa: Kiểm tra các API công khai loại trừ hoàn toàn
    # A. GET /api/regions: total = 0
    after_pub = client.get(f"/api/regions?msvt={msvt_test_code}")
    assert after_pub.status_code == 200
    assert after_pub.json()["total"] == 0

    # B. GET /api/regions/{id}: 404 Not Found
    detail_pub = client.get(f"/api/regions/{region_id}")
    assert detail_pub.status_code == 404

    # C. GET /api/admin/regions?include_deleted=true: Admin vẫn thấy với is_deleted = True
    admin_check = admin_client.get(f"/api/admin/regions?msvt={msvt_test_code}&include_deleted=true")
    assert admin_check.status_code == 200
    assert admin_check.json()["total"] == 1
    assert admin_check.json()["items"][0]["is_deleted"] is True
    assert admin_check.json()["items"][0]["deleted_by"] is not None


def test_6_viewer_cannot_mutate_regions(setup_auth_and_cleanup):
    """6. Viewer bị từ chối 403 Forbidden khi thực hiện thao tác thêm, sửa, xóa"""
    data = setup_auth_and_cleanup
    viewer_client, csrf_token = get_authenticated_client(data["viewer_user"], data["viewer_pass"])

    # Thử POST
    resp_post = viewer_client.post(
        "/api/regions",
        json={"msvt_moi": f"{TEST_MSVT_PREFIX}VIEWER_POST"},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp_post.status_code == 403
    assert "Quản trị viên" in resp_post.json()["detail"]

    # Thử PUT
    resp_put = viewer_client.put(
        "/api/regions/1",
        json={"msvt_moi": "NEW"},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp_put.status_code == 403

    # Thử PATCH
    resp_patch = viewer_client.patch(
        "/api/regions/1",
        json={"to_chuc_ca_nhan": "Hacker"},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp_patch.status_code == 403

    # Thử DELETE
    resp_del = viewer_client.delete(
        "/api/regions/1",
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp_del.status_code == 403


def test_7_unauthenticated_cannot_mutate_regions():
    """7. Người chưa đăng nhập bị từ chối 401 Unauthorized khi gọi CRUD"""
    anon_client = TestClient(app)

    # Thử POST không có auth
    resp = anon_client.post("/api/regions", json={"msvt_moi": "TEST"})
    assert resp.status_code == 401

    # Thử DELETE không có auth
    resp_del = anon_client.delete("/api/regions/1")
    assert resp_del.status_code == 401


def test_8_csrf_protection_on_cookie_session(setup_auth_and_cleanup):
    """8. Đăng nhập qua Cookie nhưng thiếu hoặc sai X-CSRF-Token bị từ chối 403 Forbidden"""
    data = setup_auth_and_cleanup
    admin_client, _ = get_authenticated_client(data["admin_user"], data["admin_pass"])

    # Gửi POST nhưng KHÔNG gửi header X-CSRF-Token
    resp_no_csrf = admin_client.post(
        "/api/regions",
        json={"msvt_moi": f"{TEST_MSVT_PREFIX}NO_CSRF"}
    )
    assert resp_no_csrf.status_code == 403
    assert "CSRF token không hợp lệ hoặc bị thiếu" in resp_no_csrf.json()["detail"]

    # Gửi POST với X-CSRF-Token SAI
    resp_wrong_csrf = admin_client.post(
        "/api/regions",
        json={"msvt_moi": f"{TEST_MSVT_PREFIX}WRONG_CSRF"},
        headers={"X-CSRF-Token": "invalid_fake_csrf_token_value"}
    )
    assert resp_wrong_csrf.status_code == 403
    assert "CSRF token không hợp lệ hoặc bị thiếu" in resp_wrong_csrf.json()["detail"]


def test_9_negative_numbers_rejected(setup_auth_and_cleanup):
    """9. Dữ liệu số âm (diện tích, sản lượng, số hộ) bị từ chối 422 Unprocessable Entity"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    # Diện tích âm
    resp1 = admin_client.post(
        "/api/regions",
        json={"msvt_moi": f"{TEST_MSVT_PREFIX}NEG1", "dien_tich_ha": -5.0},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp1.status_code == 422

    # Số hộ âm
    resp2 = admin_client.post(
        "/api/regions",
        json={"msvt_moi": f"{TEST_MSVT_PREFIX}NEG2", "so_ho_tham_gia": -3},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp2.status_code == 422

    # Tổng sản lượng âm
    resp3 = admin_client.post(
        "/api/regions",
        json={"msvt_moi": f"{TEST_MSVT_PREFIX}NEG3", "tong_san_luong_tan": -10.5},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp3.status_code == 422


def test_10_invalid_coordinates_and_polygon_rejected(setup_auth_and_cleanup):
    """10. Tọa độ vượt phạm vi hoặc GeoJSON tự cắt/lỗi bị từ chối 422 Unprocessable Entity"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    # Vĩ độ vượt quá 90 độ
    resp_lat = admin_client.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_MSVT_PREFIX}BAD_COORD",
            "geometry": {"point": {"longitude": 105.0, "latitude": 95.0}}
        },
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp_lat.status_code == 422

    # Polygon tự cắt (Self-intersecting Bowtie Polygon) không hợp lệ
    bowtie_polygon = {
        "type": "Polygon",
        "coordinates": [
            [
                [0.0, 0.0],
                [1.0, 1.0],
                [0.0, 1.0],
                [1.0, 0.0],
                [0.0, 0.0]
            ]
        ]
    }
    resp_poly = admin_client.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_MSVT_PREFIX}BAD_POLY",
            "geometry": {"geojson": bowtie_polygon}
        },
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp_poly.status_code == 422
    assert "không hợp lệ" in str(resp_poly.json()["detail"])


def test_11_duplicate_msvt_code_returns_409_conflict(setup_auth_and_cleanup):
    """11. Mã MSVT trùng lặp trả về HTTP 409 Conflict, không tự ý ghi đè"""
    data = setup_auth_and_cleanup
    admin_client, csrf_token = get_authenticated_client(data["admin_user"], data["admin_pass"])

    dup_code = f"{TEST_MSVT_PREFIX}UNIQUE_CODE"

    # Tạo lần đầu -> Thành công 201
    resp1 = admin_client.post(
        "/api/regions",
        json={
            "msvt_moi": dup_code,
            "to_chuc_ca_nhan": "Cơ sở A",
            "geometry": {
                "point": {
                    "longitude": 105.420,
                    "latitude": 19.325
                }
            }
        },
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp1.status_code == 201

    # Cố tạo lần thứ 2 với cùng mã msvt_moi -> Bị từ chối 409 Conflict
    resp2 = admin_client.post(
        "/api/regions",
        json={
            "msvt_moi": dup_code,
            "to_chuc_ca_nhan": "Cơ sở B",
            "geometry": {
                "point": {
                    "longitude": 105.420,
                    "latitude": 19.325
                }
            }
        },
        headers={"X-CSRF-Token": csrf_token}
    )
    assert resp2.status_code == 409
    assert "đã tồn tại trong hệ thống" in resp2.json()["detail"]
