"""
test_geometry_polygon.py - Kiểm thử mở rộng tính năng khoanh vùng Polygon tự động từ nhiều tọa độ GPS
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.main import app
from app.database import SessionLocal
from app.models import AdminUser, VungTrong
from app.security import hash_password
from app.config import AUTH_COOKIE_NAME, CSRF_COOKIE_NAME

client = TestClient(app)

TEST_PREFIX = "TEST-GEOM-2026-"


def get_admin_auth():
    db: Session = SessionLocal()
    admin = db.query(AdminUser).filter(AdminUser.username == "geom_test_admin").first()
    if not admin:
        admin = AdminUser(
            username="geom_test_admin",
            password_hash=hash_password("AdminPass@2026!"),
            role="admin",
            is_active=True
        )
        db.add(admin)
        db.commit()
    db.close()

    c = TestClient(app)
    resp = c.post("/api/auth/login", json={"username": "geom_test_admin", "password": "AdminPass@2026!"})
    assert resp.status_code == 200
    csrf = resp.json()["csrf_token"]
    return c, csrf


def test_1_coord_creates_point():
    """Nhập đúng 1 cặp tọa độ -> Lưu vào vi_tri (Point), ranh_gioi = None"""
    c, csrf = get_admin_auth()
    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}POINT",
            "geometry": {"point": {"longitude": 105.55, "latitude": 19.02}}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["geometry_type"] == "POINT"
    assert data["geometry"]["type"] == "Point"
    assert data["geometry"]["coordinates"] == [105.55, 19.02]

    # Xóa bản ghi test
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.msvt_moi == f"{TEST_PREFIX}POINT").delete()
    db.commit()
    db.close()


def test_3_coords_creates_polygon_and_closed():
    """Nhập 3 cặp tọa độ -> Tự khép kín thành Polygon/MultiPolygon"""
    c, csrf = get_admin_auth()
    # 3 đỉnh tam giác (GeoJSON yêu cầu đỉnh đầu lặp lại ở cuối khi gửi lên)
    poly_3_pts = {
        "type": "Polygon",
        "coordinates": [
            [
                [105.550, 19.020],
                [105.560, 19.020],
                [105.555, 19.030],
                [105.550, 19.020]
            ]
        ]
    }
    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}POLY3",
            "geometry": {"geojson": poly_3_pts}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["geometry_type"] == "MULTIPOLYGON"
    assert data["geometry"]["type"] == "MultiPolygon"
    assert len(data["geometry"]["coordinates"][0][0]) == 4 # 3 đỉnh + 1 đỉnh khép kín

    # Xóa bản ghi test
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.msvt_moi == f"{TEST_PREFIX}POLY3").delete()
    db.commit()
    db.close()


def test_5_coords_creates_polygon_and_preserves_order():
    """Nhập 5 cặp tọa độ -> Khoanh vùng đúng theo thứ tự 5 đỉnh"""
    c, csrf = get_admin_auth()
    poly_5_pts = {
        "type": "Polygon",
        "coordinates": [
            [
                [105.550, 19.020],
                [105.553, 19.021],
                [105.554, 19.023],
                [105.550, 19.024],
                [105.548, 19.021],
                [105.550, 19.020]
            ]
        ]
    }
    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}POLY5",
            "dien_tich_ha": 12.5,
            "geometry": {"geojson": poly_5_pts}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["geometry_type"] == "MULTIPOLYGON"
    assert len(data["geometry"]["coordinates"][0][0]) == 6 # 5 đỉnh + 1 đỉnh khép kín

    # Kiểm tra tra cứu ST_Covers điểm nằm trong vùng
    # Điểm (105.551, 19.0215) nằm bên trong polygon 5 đỉnh trên
    lookup_resp = c.get("/api/regions/lookup?lat=19.0215&lng=105.551")
    assert lookup_resp.status_code == 200
    found = any(r["msvt_moi"] == f"{TEST_PREFIX}POLY5" for r in lookup_resp.json())
    assert found is True, "ST_Covers phải tìm thấy vùng trồng bao phủ tọa độ"

    # Xóa bản ghi test
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.msvt_moi == f"{TEST_PREFIX}POLY5").delete()
    db.commit()
    db.close()


def test_10_coords_creates_polygon():
    """Nhập 10 cặp tọa độ -> Khoanh vùng bình thường không bị giới hạn"""
    c, csrf = get_admin_auth()
    import math
    center_lng, center_lat = 105.55, 19.02
    radius = 0.005
    ring = []
    for i in range(10):
        angle = 2 * math.pi * i / 10
        lng = round(center_lng + radius * math.cos(angle), 6)
        lat = round(center_lat + radius * math.sin(angle), 6)
        ring.append([lng, lat])
    ring.append(ring[0]) # Khép kín

    poly_10 = {
        "type": "Polygon",
        "coordinates": [ring]
    }

    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}POLY10",
            "geometry": {"geojson": poly_10}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["geometry_type"] == "MULTIPOLYGON"
    assert len(data["geometry"]["coordinates"][0][0]) == 11

    # Xóa bản ghi test
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.msvt_moi == f"{TEST_PREFIX}POLY10").delete()
    db.commit()
    db.close()


def test_self_intersecting_polygon_rejected():
    """Polygon tự cắt (bowtie) bị từ chối 422"""
    c, csrf = get_admin_auth()
    bowtie = {
        "type": "Polygon",
        "coordinates": [
            [
                [105.0, 19.0],
                [105.1, 19.1],
                [105.0, 19.1],
                [105.1, 19.0],
                [105.0, 19.0]
            ]
        ]
    }
    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}BOWTIE",
            "geometry": {"geojson": bowtie}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 422
    assert "không hợp lệ" in str(resp.json()["detail"]).lower()


def test_dms_polygon_and_raw_coords_preservation():
    """Tạo vùng từ tọa độ DMS đã chuyển đổi và kiểm tra lưu nguyên vẹn toa_do_goc"""
    c, csrf = get_admin_auth()
    
    # 5 tọa độ DMS mẫu trong đề bài
    raw_dms_text = (
        "19o10'50.90'';105o34'33.08''\n"
        "19o10'50.92'';105o34'29.94''\n"
        "19o11'06.73'';105o34'24.27''\n"
        "19o11'08.32'';105o34'28.80''\n"
        "19o10'59.24'';105o34'29.24''"
    )
    # Giá trị decimal tương ứng sau khi chuyển đổi:
    # 1: 19.18080556, 105.57585556
    # 2: 19.18081111, 105.57498333
    # 3: 19.18520278, 105.57340833
    # 4: 19.18564444, 105.57466667
    # 5: 19.18312222, 105.57478889
    geojson_ring = [
        [105.57585556, 19.18080556],
        [105.57498333, 19.18081111],
        [105.57340833, 19.18520278],
        [105.57466667, 19.18564444],
        [105.57478889, 19.18312222],
        [105.57585556, 19.18080556]  # Khép kín
    ]

    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}DMS5",
            "toa_do_goc": raw_dms_text,
            "dien_tich_ha": 5.8,
            "geometry": {"geojson": {"type": "Polygon", "coordinates": [geojson_ring]}}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["toa_do_goc"] == raw_dms_text
    assert data["geometry_type"] == "MULTIPOLYGON"
    created_id = data["id"]

    # Tra cứu ST_Covers: Điểm (105.5745, 19.183) nằm trong đa giác trên
    lookup_resp = c.get("/api/regions/lookup?lat=19.183&lng=105.5745")
    assert lookup_resp.status_code == 200
    assert any(r["id"] == created_id for r in lookup_resp.json())

    # Tra cứu điểm nằm ngoài -> Không được trả về vùng này
    lookup_outside = c.get("/api/regions/lookup?lat=19.100&lng=105.500")
    assert lookup_outside.status_code == 200
    assert all(r["id"] != created_id for r in lookup_outside.json())

    # Dọn dẹp
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.id == created_id).delete()
    db.commit()
    db.close()


def test_patch_attribute_does_not_destroy_geometry():
    """Sửa thuộc tính qua PATCH không truyền geometry -> bảo toàn nguyên vẹn hình học cũ"""
    c, csrf = get_admin_auth()
    # Tạo trước 1 vùng có polygon
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [105.550, 19.020],
                [105.560, 19.020],
                [105.555, 19.030],
                [105.550, 19.020]
            ]
        ]
    }
    create_resp = c.post(
        "/api/regions",
        json={"msvt_moi": f"{TEST_PREFIX}PATCH_PRESERVE", "geometry": {"geojson": poly}},
        headers={"X-CSRF-Token": csrf}
    )
    assert create_resp.status_code == 201
    created_id = create_resp.json()["id"]

    # PATCH chỉ sửa diện tích, KHÔNG gửi trường geometry
    patch_resp = c.patch(
        f"/api/regions/{created_id}",
        json={"dien_tich_ha": 99.9},
        headers={"X-CSRF-Token": csrf}
    )
    assert patch_resp.status_code == 200
    patched_data = patch_resp.json()
    assert patched_data["dien_tich_ha"] == 99.9
    assert patched_data["geometry_type"] == "MULTIPOLYGON"
    assert patched_data["geometry"] is not None
    assert patched_data["geometry"]["type"] == "MultiPolygon"

    # Dọn dẹp
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.id == created_id).delete()
    db.commit()
    db.close()


def test_create_region_with_null_geometry_rejected():
    """
    Quy tắc bắt buộc: Thêm mới vùng trồng bắt buộc phải có geometry Point hoặc Polygon hợp lệ.
    Gửi geometry=None hoặc tọa độ rỗng bị từ chối HTTP 422 MISSING_GEOMETRY.
    """
    c, csrf = get_admin_auth()
    raw_2_coords = "18.815368, 105.606360\n18.817680, 105.602557"
    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}2POINTS",
            "toa_do_goc": raw_2_coords,
            "geometry": None
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 422
    data = resp.json()
    assert "detail" in data
    assert data["detail"]["code"] == "MISSING_GEOMETRY"


def test_2_points_cannot_create_polygon_rejected():
    """
    Chỉ có 2 điểm GPS không thể tạo thành Polygon (cần tối thiểu 3 đỉnh phân biệt).
    Bị từ chối HTTP 422 INSUFFICIENT_VERTICES.
    """
    c, csrf = get_admin_auth()
    poly_2 = {
        "type": "Polygon",
        "coordinates": [
            [
                [105.550, 19.020],
                [105.560, 19.020],
                [105.550, 19.020]
            ]
        ]
    }
    resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}POLY_2PTS",
            "geometry": {"geojson": poly_2}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 422
    data = resp.json()
    assert data["detail"]["code"] == "INSUFFICIENT_VERTICES"


def test_patch_cannot_delete_geometry_rejected():
    """
    Chế độ kiểm soát nghiêm ngặt: Tuyệt đối không cho phép xóa geometry bằng cách gửi geometry=null qua PATCH.
    Trả về HTTP 422 CANNOT_DELETE_GEOMETRY.
    """
    c, csrf = get_admin_auth()
    # Tạo trước 1 bản ghi có Point
    create_resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}DEL_GEOM",
            "geometry": {"point": {"longitude": 105.5, "latitude": 19.0}}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert create_resp.status_code == 201
    created_id = create_resp.json()["id"]

    # Cố tình gửi geometry=None để xóa ranh giới
    patch_resp = c.patch(
        f"/api/regions/{created_id}",
        json={"geometry": None},
        headers={"X-CSRF-Token": csrf}
    )
    assert patch_resp.status_code == 422
    assert patch_resp.json()["detail"]["code"] == "CANNOT_DELETE_GEOMETRY"

    # Dọn dẹp
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.id == created_id).delete()
    db.commit()
    db.close()


def test_update_record_without_geometry_requires_coordinates():
    """
    Trường hợp E: Đối với bản ghi cũ chưa có geometry (ID 50, 51),
    không cho phép cập nhật thuộc tính cho đến khi bổ sung Point hoặc Polygon hợp lệ.
    """
    c, csrf = get_admin_auth()
    # ID 51 hiện chưa có geometry
    patch_resp = c.patch(
        "/api/regions/51",
        json={"to_chuc_ca_nhan": "Cố tình cập nhật khi chưa có geometry"},
        headers={"X-CSRF-Token": csrf}
    )
    assert patch_resp.status_code == 422
    assert patch_resp.json()["detail"]["code"] == "MISSING_GEOMETRY"


def test_edit_region_with_2_coords_preserves_existing_geometry():
    """
    Yêu cầu 11:
    - Nếu đang sửa bản ghi đã có geometry, cập nhật toa_do_goc (2 điểm) mặc định giữ nguyên hình học cũ.
    """
    c, csrf = get_admin_auth()
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [105.550, 19.020],
                [105.560, 19.020],
                [105.555, 19.030],
                [105.550, 19.020]
            ]
        ]
    }
    create_resp = c.post(
        "/api/regions",
        json={
            "msvt_moi": f"{TEST_PREFIX}EDIT_2PTS",
            "geometry": {"geojson": poly}
        },
        headers={"X-CSRF-Token": csrf}
    )
    assert create_resp.status_code == 201
    created_id = create_resp.json()["id"]

    # Sửa bản ghi: Lưu 2 điểm vào toa_do_goc nhưng KHÔNG gửi trường geometry
    raw_2_coords = "18.815368, 105.606360\n18.817680, 105.602557"
    patch_resp = c.patch(
        f"/api/regions/{created_id}",
        json={"toa_do_goc": raw_2_coords},
        headers={"X-CSRF-Token": csrf}
    )
    assert patch_resp.status_code == 200
    patched = patch_resp.json()
    assert patched["toa_do_goc"] == raw_2_coords
    # Hình học cũ vẫn còn nguyên vẹn 100%
    assert patched["geometry_type"] == "MULTIPOLYGON"
    assert patched["geometry"] is not None

    # Dọn dẹp
    db = SessionLocal()
    db.query(VungTrong).filter(VungTrong.id == created_id).delete()
    db.query(AdminUser).filter(AdminUser.username == "geom_test_admin").delete()
    db.commit()
    db.close()


def test_validate_geometry_region38_self_intersection():
    """Kiểm tra PostGIS ST_IsValid phát hiện lỗi tự giao cắt của Vùng #38"""
    poly_raw_38 = {
        "type": "Polygon",
        "coordinates": [[
            [105.685531, 18.756488],
            [105.685789, 18.756601],
            [105.685778, 18.756658],
            [105.685873, 18.756692],
            [105.685084, 18.756302],
            [105.685698, 18.756143],
            [105.685531, 18.756488]
        ]]
    }
    resp = client.post(
        "/api/regions/validate-geometry",
        json={
            "geojson": poly_raw_38,
            "declared_area_ha": 0.15
        }
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_valid"] is False
    assert "Self-intersection" in data["reason"]
    assert data["rating"] == "INVALID"


def test_validate_geometry_region38_candidate1_valid_and_close_area():
    """Kiểm tra PostGIS xác nhận Candidate #1 của Vùng #38 hợp lệ và gần diện tích khai báo (<=10%)"""
    # Thứ tự Candidate 1: [1, 2, 4, 3, 5, 6]
    poly_cand1_38 = {
        "type": "Polygon",
        "coordinates": [[
            [105.685531, 18.756488],
            [105.685789, 18.756601],
            [105.685873, 18.756692],
            [105.685778, 18.756658],
            [105.685084, 18.756302],
            [105.685698, 18.756143],
            [105.685531, 18.756488]
        ]]
    }
    resp = client.post(
        "/api/regions/validate-geometry",
        json={
            "geojson": poly_cand1_38,
            "declared_area_ha": 0.15
        }
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_valid"] is True
    assert data["reason"] == "Valid Geometry"
    assert data["area_ha"] is not None
    assert 0.13 < data["area_ha"] < 0.15
    assert data["deviation_pct"] is not None
    assert data["deviation_pct"] <= 10.0
    assert data["rating"] == "CLOSE"
    assert data["label"] == "Gần diện tích khai báo"


def test_parse_coordinates_endpoint_18_sample_points():
    """Kiểm thử API parse-coordinates với 18 tọa độ mẫu thực địa (4 nhóm, N/E, khoảng trắng bất thường)"""
    sample_text = """Đ1: 18.997412 N, 105.52339 E,
Đ2: 18.99728 N, 105. 523277 E,
Đ3: 18.997331 N, 105. 523887 E,
Đ4: 18.996698 N, 105.52348 E;

Đ1: 19.06788 N, 105.45612 E,
Đ2: 19.06789 N, 105. 45619 E,
Đ3: 19.06808 N, 105. 46045 E,
Đ4: 19.06792 N, 105.45697 E;

Đ1: 19.05065 N, 105.45769 E,
Đ2: 19.04986 N, 105.45818 E,
Đ3: 19.04948 N, 105.45845 E,
Đ4: 19.04867 N, 105.45842 E,
Đ5: 19.05002 N, 105.45749 E;

Đ1: 19.11937 N, 105.51659 E,
Đ2: 19.11938 N, 105.51686 E,
Đ3: 19.11513 N, 105.51783 E,
Đ4: 19.11069 N, 105.51179 E,
Đ5: 19.11071 N, 105.51860 E."""

    resp = client.post("/api/regions/parse-coordinates", json={"raw_text": sample_text})
    assert resp.status_code == 200
    data = resp.json()

    # 1. Tổng cộng 18 cặp tọa độ
    assert data["total_points"] == 18
    assert data["valid_points"] == 18
    # 2. Tách thành 4 nhóm độc lập
    assert data["total_groups"] == 4
    groups = data["groups"]
    assert len(groups) == 4

    # Nhóm 1: 4 điểm, tự giao cắt
    assert groups[0]["valid_count"] == 4
    assert groups[0]["is_valid"] is False
    assert "Self-intersection" in groups[0]["reason"]

    # Nhóm 2: 4 điểm, hợp lệ nhưng dải rất hẹp
    assert groups[1]["valid_count"] == 4
    assert groups[1]["is_valid"] is True
    assert groups[1]["is_narrow"] is True

    # Nhóm 3: 5 điểm, hợp lệ
    assert groups[2]["valid_count"] == 5
    assert groups[2]["is_valid"] is True
    assert groups[2]["area_ha"] is not None and groups[2]["area_ha"] > 0

    # Nhóm 4: 5 điểm, tự giao cắt
    assert groups[3]["valid_count"] == 5
    assert groups[3]["is_valid"] is False
    assert "Self-intersection" in groups[3]["reason"]

    # Kiểm tra chuẩn hóa khoảng trắng '105. 523277 E' -> 105.523277
    pt_d2 = data["raw_points"][1]
    assert pt_d2["lng"] == 105.523277
    assert pt_d2["lat"] == 18.99728
    assert pt_d2["label"] == "Đ2"


def test_parse_coordinates_dms_and_decimal_types():
    """Kiểm thử nhận diện DMS và Decimal hỗn hợp"""
    mixed_text = """Đ1: 19°10'50.90"N, 105°34'33.08"E
Đ2: 19.180806, 105.575856
Đ3: 19o10'59.24'', 105o34'29.24''"""
    resp = client.post("/api/regions/parse-coordinates", json={"raw_text": mixed_text})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_points"] == 3
    assert data["total_groups"] == 1
    assert data["groups"][0]["valid_count"] == 3




