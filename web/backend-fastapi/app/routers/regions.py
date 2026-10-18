import json
import math
import logging
from typing import Optional, List, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import text, or_
from shapely.geometry import shape, Point, Polygon, MultiPolygon, mapping
from geoalchemy2.shape import from_shape, to_shape

from ..database import get_db
from ..models import VungTrong, AdminUser
from ..dependencies import require_admin, require_csrf
from ..schemas import (
    PaginatedRegionsResponse,
    RegionListItem,
    RegionDetail,
    GeoJSONFeatureCollection,
    GeoJSONFeature,
    StatisticsResponse,
    GeometryStats,
    GeometryInput,
    RegionCreate,
    RegionUpdate,
    RegionPatch,
    AdminRegionDetail,
    AdminPaginatedRegionsResponse,
    GeometryValidationRequest,
    GeometryValidationResponse,
    ParseCoordinatesRequest
)

logger = logging.getLogger("webgis_msvt_crud")

router = APIRouter(prefix="/api", tags=["Vùng Trồng MSVT"])


def get_geojson_geometry(region: VungTrong) -> Optional[dict[str, Any]]:
    """Trích xuất GeoJSON geometry chuẩn từ đối tượng VungTrong"""
    try:
        if region.ranh_gioi is not None:
            return mapping(to_shape(region.ranh_gioi))
        elif region.vi_tri is not None:
            return mapping(to_shape(region.vi_tri))
    except Exception as e:
        logger.warning(f"Không thể chuyển đổi geometry sang GeoJSON cho vùng ID={getattr(region, 'id', 'N/A')}: {e}")
    return None


def find_self_intersecting_edges(ring: List[Any]) -> List[str]:
    """
    Tìm danh sách các cặp cạnh tự giao cắt trong linear ring.
    ring là danh sách các tọa độ [ [lng, lat], ... ] có đỉnh đầu = đỉnh cuối.
    Các cạnh được đánh số 1-indexed: cạnh giữa đỉnh 1 và đỉnh 2 là "1-2".
    """
    from shapely.geometry import LineString
    n = len(ring) - 1
    if n < 3:
        return []
    segments = []
    for i in range(n):
        p1 = ring[i]
        p2 = ring[i + 1]
        segments.append((i, i + 1, LineString([p1, p2])))

    affected = set()
    for i in range(len(segments)):
        for j in range(i + 1, len(segments)):
            idx1_a, idx1_b, seg1 = segments[i]
            idx2_a, idx2_b, seg2 = segments[j]
            # Bỏ qua các cạnh liền kề (chia sẻ chung 1 đỉnh)
            if idx1_b == idx2_a or (idx1_a == 0 and idx2_b == n):
                if seg1.crosses(seg2) or (seg1.intersects(seg2) and not seg1.touches(seg2)):
                    affected.add(f"{idx1_a + 1}-{idx1_b + 1}")
                    affected.add(f"{idx2_a + 1}-{idx2_b + 1}")
            else:
                if seg1.intersects(seg2):
                    affected.add(f"{idx1_a + 1}-{idx1_b + 1}")
                    affected.add(f"{idx2_a + 1}-{idx2_b + 1}")
    return sorted(list(affected))


def validate_strict_geometry(
    db: Session,
    geom_input: Optional[GeometryInput],
    is_create: bool = False,
    existing_has_geom: bool = True
) -> tuple[Optional[Any], Optional[Any], bool]:
    """
    Kiểm định hình học nghiêm ngặt theo quy tắc WebGIS MSVT (Cả Shapely và PostGIS ST_IsValid):
    - is_create = True: BẮT BUỘC có Point hoặc Polygon/MultiPolygon hợp lệ đã xác nhận. Không cho phép rỗng.
    - is_create = False:
        + Nếu geom_input rỗng và existing_has_geom = True: Giữ nguyên hình học cũ (return None, None, True).
        + Nếu geom_input rỗng và existing_has_geom = False (Trường hợp E): Từ chối 422 yêu cầu bổ sung tọa độ.
        + Nếu geom_input có dữ liệu: kiểm định nghiêm ngặt toàn bộ.
    - Point: đúng 1 cặp vĩ độ/kinh độ hữu hạn trong phạm vi [-90..90, -180..180].
    - Polygon: tối thiểu 3 đỉnh phân biệt, khép kín, không cạnh độ dài 0, không tự giao cắt (chỉ rõ cạnh lỗi),
      diện tích > 0, ST_IsValid = True trên PostGIS.
    - MultiPolygon: mỗi đa giác con hợp lệ và cấu trúc tổng thể ST_IsValid = True.
    - KHÔNG tự động ST_MakeValid hay Convex Hull để lách lỗi.
    - Trả về tuple: (vi_tri_elem, ranh_gioi_elem, keep_old_geometry)
    """
    if geom_input is None or (geom_input.point is None and geom_input.geojson is None):
        if is_create:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "MISSING_GEOMETRY",
                    "message": "Không thể lưu vùng trồng mới: Bắt buộc phải có tọa độ Point hợp lệ hoặc Polygon/MultiPolygon hợp lệ đã xác nhận.",
                    "reason": "Vùng trồng mới bắt buộc phải có dữ liệu không gian hợp lệ."
                }
            )
        if not existing_has_geom:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "MISSING_GEOMETRY",
                    "message": "Vùng trồng này hiện chưa có dữ liệu không gian. Ở chế độ kiểm soát nghiêm ngặt, bắt buộc phải bổ sung Point hoặc Polygon hợp lệ trước khi lưu cập nhật.",
                    "reason": "Existing record has no geometry"
                }
            )
        return None, None, True

    if geom_input.point is not None and geom_input.geojson is not None:
        gtype = geom_input.geojson.get("type") if isinstance(geom_input.geojson, dict) else None
        if gtype == "Point":
            geom_input.geojson = None
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "AMBIGUOUS_GEOMETRY",
                    "message": "Không thể gửi đồng thời cả Point và Polygon. Vui lòng chỉ chọn một loại hình học.",
                    "reason": "Both Point and GeoJSON provided"
                }
            )

    # 1. Xử lý và kiểm định Point
    if geom_input.point is not None:
        lat = geom_input.point.latitude
        lng = geom_input.point.longitude
        if not (math.isfinite(lat) and math.isfinite(lng)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "INVALID_COORDINATES",
                    "message": "Tọa độ Point không hợp lệ (chứa giá trị NaN hoặc không hữu hạn).",
                    "reason": "Non-finite coordinate values"
                }
            )
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "OUT_OF_BOUNDS_COORDINATES",
                    "message": f"Tọa độ Point ({lat}, {lng}) nằm ngoài phạm vi WGS84 EPSG:4326.",
                    "reason": "Coordinates out of WGS84 range"
                }
            )
        vi_tri = from_shape(Point(lng, lat), srid=4326)
        return vi_tri, None, False

    # 2. Xử lý và kiểm định GeoJSON (Polygon / MultiPolygon)
    if geom_input.geojson is not None:
        gtype = geom_input.geojson.get("type")
        coords = geom_input.geojson.get("coordinates")

        if not gtype or coords is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "INVALID_GEOJSON",
                    "message": "Dữ liệu GeoJSON thiếu thuộc tính 'type' hoặc 'coordinates'.",
                    "reason": "Missing required GeoJSON fields"
                }
            )

        # Hỗ trợ Point gửi dưới dạng GeoJSON
        if gtype == "Point":
            if not isinstance(coords, (list, tuple)) or len(coords) < 2:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "INVALID_POINT",
                        "message": "Mảng tọa độ Point GeoJSON không hợp lệ (cần [lng, lat]).",
                        "reason": "Invalid Point coordinates"
                    }
                )
            lng, lat = coords[0], coords[1]
            if not (math.isfinite(lat) and math.isfinite(lng)):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "INVALID_COORDINATES", "message": "Tọa độ Point chứa giá trị NaN.", "reason": "Non-finite coordinate"}
                )
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "OUT_OF_BOUNDS_COORDINATES", "message": "Tọa độ Point vượt ngoài phạm vi WGS84.", "reason": "Out of bounds"}
                )
            return from_shape(Point(lng, lat), srid=4326), None, False

        # Hỗ trợ Polygon
        if gtype == "Polygon":
            if not isinstance(coords, list) or len(coords) == 0 or not isinstance(coords[0], list):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "INVALID_POLYGON_STRUCTURE",
                        "message": "Cấu trúc tọa độ Polygon không hợp lệ (cần mảng các vòng ranh giới).",
                        "reason": "Malformed polygon rings"
                    }
                )

            exterior = coords[0]

            # Kiểm tra từng đỉnh có hữu hạn và đúng phạm vi
            for pt_idx, pt in enumerate(exterior):
                if not isinstance(pt, (list, tuple)) or len(pt) < 2 or not math.isfinite(pt[0]) or not math.isfinite(pt[1]):
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={
                            "code": "INVALID_COORDINATES",
                            "message": f"Không thể lưu: Tọa độ tại đỉnh thứ {pt_idx + 1} không hợp lệ (không phải số hữu hạn).",
                            "reason": "Non-finite coordinate",
                            "vertex": pt_idx + 1
                        }
                    )
                if not (-180.0 <= pt[0] <= 180.0 and -90.0 <= pt[1] <= 90.0):
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={
                            "code": "OUT_OF_BOUNDS_COORDINATES",
                            "message": f"Không thể lưu: Tọa độ đỉnh {pt_idx + 1} ({pt[1]}, {pt[0]}) nằm ngoài phạm vi WGS84 EPSG:4326.",
                            "reason": "Coordinate out of bounds",
                            "vertex": pt_idx + 1
                        }
                    )

            # Kiểm tra số đỉnh tối thiểu (cần >= 4 điểm khi khép kín: 3 đỉnh phân biệt + 1 điểm khép)
            if len(exterior) < 4:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "INSUFFICIENT_VERTICES",
                        "message": f"Không thể lưu: Chỉ có {max(0, len(exterior) - 1)} điểm GPS, cần tối thiểu 3 đỉnh phân biệt để tạo Polygon.",
                        "reason": "Fewer than 3 distinct vertices"
                    }
                )

            # Kiểm tra đóng vòng
            if exterior[0][0] != exterior[-1][0] or exterior[0][1] != exterior[-1][1]:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "UNCLOSED_POLYGON",
                        "message": "Không thể lưu: Đa giác chưa được đóng vòng đúng quy tắc (đỉnh đầu và đỉnh cuối phải trùng nhau).",
                        "reason": "Ring is not closed"
                    }
                )

            # Kiểm tra số đỉnh phân biệt
            distinct_pts = set((round(p[0], 7), round(p[1], 7)) for p in exterior[:-1])
            if len(distinct_pts) < 3:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "INSUFFICIENT_VERTICES",
                        "message": f"Không thể lưu: Chỉ có {len(distinct_pts)} đỉnh phân biệt, cần tối thiểu 3 đỉnh phân biệt để tạo Polygon.",
                        "reason": "Fewer than 3 distinct vertices"
                    }
                )

            # Kiểm tra cạnh có độ dài bằng 0 (đỉnh trùng nhau liên tiếp)
            for i in range(len(exterior) - 1):
                if exterior[i][0] == exterior[i + 1][0] and exterior[i][1] == exterior[i + 1][1]:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={
                            "code": "DEGENERATE_EDGE",
                            "message": f"Không thể lưu: Đa giác chứa cạnh có độ dài bằng 0 (đỉnh {i + 1} trùng đỉnh {i + 2}).",
                            "reason": "Zero-length edge",
                            "affected_edges": [f"{i + 1}-{i + 2}"]
                        }
                    )

            # Kiểm tra tính hợp lệ bằng Shapely
            try:
                g = shape(geom_input.geojson)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "INVALID_GEOJSON",
                        "message": f"Dữ liệu GeoJSON không hợp lệ: {str(e)}",
                        "reason": str(e)
                    }
                )

            if not g.is_valid:
                from shapely.validation import explain_validity
                reason = explain_validity(g)
                affected_edges = find_self_intersecting_edges(exterior)
                edge_desc = f" giữa cạnh {', '.join(affected_edges)}" if affected_edges else ""
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "INVALID_POLYGON",
                        "message": f"Không thể lưu hoặc cập nhật vùng trồng: Đa giác không hợp lệ do bị tự giao cắt{edge_desc} ({reason}).",
                        "reason": reason,
                        "affected_edges": affected_edges
                    }
                )

            if g.is_empty or g.area <= 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "ZERO_AREA_POLYGON",
                        "message": "Không thể lưu: Đa giác có diện tích bằng 0 hoặc các đỉnh thẳng hàng.",
                        "reason": "Polygon area is zero or empty"
                    }
                )

            # Kiểm định hình học trực tiếp bằng PostGIS ST_IsValid và ST_IsValidReason
            geom_json_str = json.dumps(mapping(g))
            try:
                pg_check = db.execute(
                    text("SELECT ST_IsValid(ST_GeomFromGeoJSON(:geom)), ST_IsValidReason(ST_GeomFromGeoJSON(:geom)), ST_Area(ST_GeomFromGeoJSON(:geom)::geography) / 10000.0"),
                    {"geom": geom_json_str}
                ).fetchone()
                if pg_check:
                    is_pg_valid = bool(pg_check[0])
                    pg_reason = str(pg_check[1]) if pg_check[1] else "Invalid geometry"
                    pg_area = float(pg_check[2]) if pg_check[2] is not None else 0.0
                    if not is_pg_valid:
                        affected_edges = find_self_intersecting_edges(exterior)
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                            detail={
                                "code": "INVALID_POLYGON",
                                "message": f"Không thể cập nhật vùng trồng: Hình học không hợp lệ, PostGIS ST_IsValid không đạt ({pg_reason}).",
                                "reason": pg_reason,
                                "affected_edges": affected_edges
                            }
                        )
                    if pg_area <= 0:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                            detail={
                                "code": "ZERO_AREA_POLYGON",
                                "message": "Không thể lưu: Diện tích hình học trên mặt cầu ellipsoid WGS84 bằng 0.",
                                "reason": "PostGIS ellipsoidal area is zero"
                            }
                        )
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"Lỗi truy vấn ST_IsValid PostGIS: {e}")

            if isinstance(g, Polygon):
                ranh_gioi = from_shape(MultiPolygon([g]), srid=4326)
            elif isinstance(g, MultiPolygon):
                ranh_gioi = from_shape(g, srid=4326)
            else:
                ranh_gioi = from_shape(MultiPolygon([g]), srid=4326)  # type: ignore
            return None, ranh_gioi, False

        # Hỗ trợ MultiPolygon
        if gtype == "MultiPolygon":
            if not isinstance(coords, list) or len(coords) == 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "INVALID_MULTIPOLYGON", "message": "MultiPolygon không chứa đa giác nào.", "reason": "Empty coordinates"}
                )

            for p_idx, poly_coords in enumerate(coords):
                if not isinstance(poly_coords, list) or len(poly_coords) == 0:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={"code": "INVALID_MULTIPOLYGON", "message": f"Nhóm tọa độ thứ {p_idx + 1} không hợp lệ.", "reason": "Empty sub-polygon"}
                    )
                poly_ext = poly_coords[0]
                if len(poly_ext) < 4:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={"code": "INSUFFICIENT_VERTICES", "message": f"Nhóm tọa độ thứ {p_idx + 1} có ít hơn 3 đỉnh phân biệt.", "reason": "Sub-polygon has fewer than 3 vertices"}
                    )
                if poly_ext[0][0] != poly_ext[-1][0] or poly_ext[0][1] != poly_ext[-1][1]:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={"code": "UNCLOSED_POLYGON", "message": f"Nhóm tọa độ thứ {p_idx + 1} chưa được đóng vòng.", "reason": "Sub-polygon ring not closed"}
                    )
                distinct_sub = set((round(p[0], 7), round(p[1], 7)) for p in poly_ext[:-1])
                if len(distinct_sub) < 3:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={"code": "INSUFFICIENT_VERTICES", "message": f"Nhóm tọa độ thứ {p_idx + 1} có ít hơn 3 đỉnh phân biệt.", "reason": "Fewer than 3 distinct vertices"}
                    )

            try:
                g = shape(geom_input.geojson)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "INVALID_GEOJSON", "message": f"Lỗi phân tích MultiPolygon: {str(e)}", "reason": str(e)}
                )

            if not g.is_valid:
                from shapely.validation import explain_validity
                reason = explain_validity(g)
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "INVALID_MULTIPOLYGON", "message": f"Không thể cập nhật: MultiPolygon không hợp lệ ({reason}).", "reason": reason}
                )

            if g.is_empty or g.area <= 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "ZERO_AREA_POLYGON", "message": "MultiPolygon có diện tích bằng 0.", "reason": "Zero area"}
                )

            geom_json_str = json.dumps(mapping(g))
            try:
                pg_check = db.execute(
                    text("SELECT ST_IsValid(ST_GeomFromGeoJSON(:geom)), ST_IsValidReason(ST_GeomFromGeoJSON(:geom)), ST_Area(ST_GeomFromGeoJSON(:geom)::geography) / 10000.0"),
                    {"geom": geom_json_str}
                ).fetchone()
                if pg_check:
                    if not bool(pg_check[0]):
                        pg_reason = str(pg_check[1]) if pg_check[1] else "Invalid MultiPolygon"
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                            detail={"code": "INVALID_MULTIPOLYGON", "message": f"Không thể cập nhật: Nhóm tọa độ có Polygon không hợp lệ ({pg_reason}).", "reason": pg_reason}
                        )
                    if pg_check[2] is not None and float(pg_check[2]) <= 0:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                            detail={"code": "ZERO_AREA_POLYGON", "message": "MultiPolygon có diện tích trắc địa bằng 0 ha.", "reason": "Zero area"}
                        )
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"Lỗi kiểm định ST_IsValid MultiPolygon: {e}")

            ranh_gioi = from_shape(g, srid=4326)
            return None, ranh_gioi, False

        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "UNSUPPORTED_GEOMETRY_TYPE",
                "message": f"Kiểu hình học '{gtype}' không được hỗ trợ. Chỉ hỗ trợ Point, Polygon hoặc MultiPolygon.",
                "reason": "Unsupported geometry type"
            }
        )

    return None, None, False


def check_duplicate_msvt(
    db: Session,
    msvt_moi: Optional[str],
    msvt_cu: Optional[str],
    exclude_id: Optional[int] = None
):
    """
    Kiểm tra mã trùng lặp với các bản ghi đang hoạt động (chưa bị xóa mềm).
    Nếu trùng lặp, trả về mã HTTP 409 Conflict thay vì ghi đè.
    """
    codes_to_check = []
    if msvt_moi and msvt_moi.strip():
        codes_to_check.append(msvt_moi.strip())
    if msvt_cu and msvt_cu.strip():
        codes_to_check.append(msvt_cu.strip())

    if not codes_to_check:
        return

    query = db.query(VungTrong).filter(
        VungTrong.is_deleted == False,
        or_(
            VungTrong.msvt_moi.in_(codes_to_check),
            VungTrong.msvt_cu.in_(codes_to_check)
        )
    )

    if exclude_id is not None:
        query = query.filter(VungTrong.id != exclude_id)

    duplicate = query.first()
    if duplicate:
        dup_code = duplicate.msvt_moi if duplicate.msvt_moi in codes_to_check else duplicate.msvt_cu
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Mã số vùng trồng '{dup_code}' đã tồn tại trong hệ thống (ID={duplicate.id}). Không thể tạo trùng lặp."
        )


# ==============================================================================
# 1. API CÔNG KHAI (PUBLIC READ) - TỰ ĐỘNG LOẠI TRỪ CÁC BẢN GHI ĐÃ XÓA MỀM
# ==============================================================================
@router.get("/regions", response_model=PaginatedRegionsResponse, summary="Danh sách vùng trồng công khai")
def get_regions(
    page: int = Query(1, ge=1, description="Số thứ tự trang (bắt đầu từ 1)"),
    page_size: int = Query(20, ge=1, le=100, description="Số bản ghi trên mỗi trang (tối đa 100)"),
    msvt: Optional[str] = Query(None, description="Lọc theo mã MSVT mới hoặc cũ"),
    loai_cay: Optional[str] = Query(None, description="Lọc theo loại cây trồng"),
    thi_truong: Optional[str] = Query(None, description="Lọc theo thị trường"),
    db: Session = Depends(get_db)
):
    # Loại trừ bản ghi đã xóa mềm (is_deleted = False)
    query = db.query(VungTrong).filter(VungTrong.is_deleted == False)

    if msvt:
        search_kw = f"%{msvt.strip()}%"
        query = query.filter(or_(VungTrong.msvt_moi.ilike(search_kw), VungTrong.msvt_cu.ilike(search_kw)))

    if loai_cay:
        query = query.filter(VungTrong.loai_cay_trong.ilike(f"%{loai_cay.strip()}%"))

    if thi_truong:
        query = query.filter(VungTrong.thi_truong.ilike(f"%{thi_truong.strip()}%"))

    total = query.count()
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    records = query.order_by(VungTrong.id.asc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in records:
        geom_type = None
        has_geom = False
        if r.ranh_gioi is not None:
            geom_type = "MULTIPOLYGON"
            has_geom = True
        elif r.vi_tri is not None:
            geom_type = "POINT"
            has_geom = True

        items.append(RegionListItem(
            id=r.id,
            msvt_moi=r.msvt_moi,
            msvt_cu=r.msvt_cu,
            to_chuc_ca_nhan=r.to_chuc_ca_nhan,
            nguoi_dai_dien=r.nguoi_dai_dien,
            dia_chi_msvt=r.dia_chi_msvt,
            loai_cay_trong=r.loai_cay_trong,
            so_ho_tham_gia=r.so_ho_tham_gia,
            dien_tich_ha=float(r.dien_tich_ha) if r.dien_tich_ha is not None else None,
            tong_san_luong_tan=float(r.tong_san_luong_tan) if r.tong_san_luong_tan is not None else None,
            quy_trinh=r.quy_trinh,
            thi_truong=r.thi_truong,
            has_geometry=has_geom,
            geometry_type=geom_type
        ))

    return PaginatedRegionsResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=items
    )


@router.get("/regions/geojson", summary="Xuất lớp không gian GeoJSON FeatureCollection của các vùng trồng")
def get_regions_geojson(db: Session = Depends(get_db)):
    """
    Trả về GeoJSON FeatureCollection:
    - Loại trừ hoàn toàn các bản ghi đã xóa mềm (is_deleted = FALSE).
    - Ưu tiên ranh_gioi (MultiPolygon), nếu không có dùng vi_tri (Point).
    - Ẩn SĐT và Email bảo vệ thông tin cá nhân.
    """
    sql = text("""
        SELECT 
            id, msvt_moi, msvt_cu, to_chuc_ca_nhan, nguoi_dai_dien,
            dia_chi_msvt, loai_cay_trong, so_ho_tham_gia, dien_tich_ha,
            tong_san_luong_tan, quy_trinh, thi_truong,
            CASE WHEN ranh_gioi IS NOT NULL THEN 'MULTIPOLYGON' ELSE 'POINT' END AS geom_type,
            ST_AsGeoJSON(COALESCE(ranh_gioi, vi_tri)) AS geojson_geom,
            ST_AsGeoJSON(ST_PointOnSurface(COALESCE(ranh_gioi, vi_tri))) AS rep_pt_geom
        FROM public.vung_trong
        WHERE (vi_tri IS NOT NULL OR ranh_gioi IS NOT NULL)
          AND is_deleted = FALSE
        ORDER BY id ASC;
    """)

    results = db.execute(sql).mappings().fetchall()

    features = []
    for row in results:
        geojson_geom = row.get("geojson_geom")
        if not geojson_geom:
            continue
        geom_dict = json.loads(geojson_geom)
        rep_point = None
        rep_pt_geom = row.get("rep_pt_geom")
        if rep_pt_geom:
            try:
                rep_dict = json.loads(rep_pt_geom)
                rep_point = rep_dict.get("coordinates")
            except Exception:
                pass

        dien_tich_val = row.get("dien_tich_ha")
        san_luong_val = row.get("tong_san_luong_tan")
        geom_type_val = row.get("geom_type")

        properties = {
            "id": row.get("id"),
            "msvt_moi": row.get("msvt_moi"),
            "msvt_cu": row.get("msvt_cu"),
            "to_chuc_ca_nhan": row.get("to_chuc_ca_nhan"),
            "nguoi_dai_dien": row.get("nguoi_dai_dien"),
            "dia_chi_msvt": row.get("dia_chi_msvt"),
            "loai_cay_trong": row.get("loai_cay_trong"),
            "so_ho_tham_gia": row.get("so_ho_tham_gia"),
            "dien_tich_ha": float(dien_tich_val) if dien_tich_val is not None else None,
            "tong_san_luong_tan": float(san_luong_val) if san_luong_val is not None else None,
            "quy_trinh": row.get("quy_trinh"),
            "thi_truong": row.get("thi_truong"),
            "geom_type": geom_type_val,
            "verification_status": "Chưa xác minh thực địa" if geom_type_val == "MULTIPOLYGON" else "Điểm mốc đại diện",
            "representative_point": rep_point
        }
        features.append({
            "type": "Feature",
            "geometry": geom_dict,
            "properties": properties
        })

    geojson_data = {
        "type": "FeatureCollection",
        "features": features
    }

    return Response(
        content=json.dumps(geojson_data, ensure_ascii=False),
        media_type="application/geo+json"
    )


@router.get("/regions/lookup", summary="Tra cứu không gian: Tìm polygon vùng trồng bao phủ tọa độ GPS")
def lookup_region_by_coordinates(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Vĩ độ (Latitude) trong khoảng [-90, 90]"),
    lng: float = Query(..., ge=-180.0, le=180.0, description="Kinh độ (Longitude) trong khoảng [-180, 180]"),
    db: Session = Depends(get_db)
):
    """
    Sử dụng PostGIS ST_Covers tìm polygon bao phủ tọa độ.
    Loại trừ bản ghi đã xóa mềm (is_deleted = FALSE). Không suy đoán vùng lân cận.
    """
    sql = text("""
        SELECT 
            id, msvt_moi, msvt_cu, to_chuc_ca_nhan, nguoi_dai_dien,
            dia_chi_msvt, loai_cay_trong, so_ho_tham_gia, dien_tich_ha,
            tong_san_luong_tan, quy_trinh, thi_truong,
            ST_AsGeoJSON(ranh_gioi) AS geojson_geom
        FROM public.vung_trong
        WHERE ranh_gioi IS NOT NULL
          AND is_deleted = FALSE
          AND ST_Covers(ranh_gioi, ST_SetSRID(ST_Point(:lng, :lat), 4326))
        ORDER BY id ASC;
    """)

    results = db.execute(sql, {"lng": lng, "lat": lat}).mappings().fetchall()

    items = []
    for row in results:
        dien_tich_val = row.get("dien_tich_ha")
        san_luong_val = row.get("tong_san_luong_tan")
        geom_json_val = row.get("geojson_geom")

        items.append({
            "id": row.get("id"),
            "msvt_moi": row.get("msvt_moi"),
            "msvt_cu": row.get("msvt_cu"),
            "to_chuc_ca_nhan": row.get("to_chuc_ca_nhan"),
            "nguoi_dai_dien": row.get("nguoi_dai_dien"),
            "dia_chi_msvt": row.get("dia_chi_msvt"),
            "loai_cay_trong": row.get("loai_cay_trong"),
            "so_ho_tham_gia": row.get("so_ho_tham_gia"),
            "dien_tich_ha": float(dien_tich_val) if dien_tich_val is not None else None,
            "tong_san_luong_tan": float(san_luong_val) if san_luong_val is not None else None,
            "quy_trinh": row.get("quy_trinh"),
            "thi_truong": row.get("thi_truong"),
            "geometry": json.loads(geom_json_val) if geom_json_val else None
        })

    return items


@router.get("/statistics", response_model=StatisticsResponse, summary="Thống kê tổng hợp số liệu vùng trồng")
def get_statistics(db: Session = Depends(get_db)):
    """Thống kê tổng hợp số liệu (chỉ tính các bản ghi is_deleted = FALSE)"""
    sql_overview = text("""
        SELECT 
            COUNT(*) AS total_regions,
            COALESCE(SUM(dien_tich_ha), 0) AS total_area,
            COALESCE(SUM(tong_san_luong_tan), 0) AS total_yield,
            COUNT(vi_tri) AS point_count,
            COUNT(ranh_gioi) AS poly_count,
            COUNT(*) - COUNT(vi_tri) - COUNT(ranh_gioi) AS without_geom_count
        FROM public.vung_trong
        WHERE is_deleted = FALSE;
    """)
    overview_row = db.execute(sql_overview).mappings().fetchone()
    if not overview_row:
        raise HTTPException(status_code=500, detail="Không thể truy vấn dữ liệu thống kê")

    sql_crop = text("""
        SELECT COALESCE(loai_cay_trong, 'Chưa xác định') AS loai_cay, COUNT(*) AS count_val
        FROM public.vung_trong
        WHERE is_deleted = FALSE
        GROUP BY loai_cay_trong
        ORDER BY count_val DESC;
    """)
    crops = db.execute(sql_crop).mappings().fetchall()
    by_crop: dict[str, int] = {str(r.get("loai_cay")): int(r.get("count_val") or 0) for r in crops}

    sql_market = text("""
        SELECT COALESCE(thi_truong, 'Chưa xác định') AS thi_truong, COUNT(*) AS count_val
        FROM public.vung_trong
        WHERE is_deleted = FALSE
        GROUP BY thi_truong
        ORDER BY count_val DESC;
    """)
    markets = db.execute(sql_market).mappings().fetchall()
    by_market: dict[str, int] = {str(r.get("thi_truong")): int(r.get("count_val") or 0) for r in markets}

    total_regions_val = int(overview_row.get("total_regions") or 0)
    total_area_val = round(float(overview_row.get("total_area") or 0.0), 4)
    total_yield_val = round(float(overview_row.get("total_yield") or 0.0), 4)
    point_cnt_val = int(overview_row.get("point_count") or 0)
    poly_cnt_val = int(overview_row.get("poly_count") or 0)
    without_cnt_val = int(overview_row.get("without_geom_count") or 0)

    return StatisticsResponse(
        total_regions=total_regions_val,
        total_area_ha=total_area_val,
        total_recorded_yield_tons=total_yield_val,
        by_crop_type=by_crop,
        by_market=by_market,
        geometry_stats=GeometryStats(
            point_count=point_cnt_val,
            multipolygon_count=poly_cnt_val,
            without_geometry_count=without_cnt_val
        )
    )


@router.get("/regions/{id}", response_model=RegionDetail, summary="Xem thông tin chi tiết một vùng trồng theo ID")
def get_region_detail(id: int, db: Session = Depends(get_db)):
    region = db.query(VungTrong).filter(VungTrong.id == id, VungTrong.is_deleted == False).first()
    if not region:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy vùng trồng với ID={id}")

    geom_type = None
    if region.ranh_gioi is not None:
        geom_type = "MULTIPOLYGON"
    elif region.vi_tri is not None:
        geom_type = "POINT"

    return RegionDetail(
        id=region.id,
        msvt_moi=region.msvt_moi,
        msvt_cu=region.msvt_cu,
        to_chuc_ca_nhan=region.to_chuc_ca_nhan,
        nguoi_dai_dien=region.nguoi_dai_dien,
        so_dien_thoai=region.so_dien_thoai,
        email=region.email,
        toa_do_goc=region.toa_do_goc,
        dia_chi_msvt=region.dia_chi_msvt,
        loai_cay_trong=region.loai_cay_trong,
        so_ho_tham_gia=region.so_ho_tham_gia,
        dien_tich_ha=float(region.dien_tich_ha) if region.dien_tich_ha is not None else None,
        san_luong_tan_ha=float(region.san_luong_tan_ha) if region.san_luong_tan_ha is not None else None,
        tong_san_luong_tan=float(region.tong_san_luong_tan) if region.tong_san_luong_tan is not None else None,
        quy_trinh=region.quy_trinh,
        thi_truong=region.thi_truong,
        geometry_type=geom_type,
        geometry=get_geojson_geometry(region),
        created_at=region.created_at,
        updated_at=region.updated_at
    )


# ==============================================================================
# 2. API QUẢN TRỊ VIÊN (ADMIN READ & CRUD) - BẮT BUỘC REQUIRE_ADMIN & REQUIRE_CSRF
# ==============================================================================

@router.get(
    "/admin/regions",
    response_model=AdminPaginatedRegionsResponse,
    summary="[Admin] Danh sách vùng trồng đầy đủ thông tin quản trị"
)
def admin_get_regions(
    page: int = Query(1, ge=1, description="Số thứ tự trang"),
    page_size: int = Query(20, ge=1, le=100, description="Số bản ghi mỗi trang"),
    msvt: Optional[str] = Query(None, description="Lọc theo mã MSVT"),
    loai_cay: Optional[str] = Query(None, description="Lọc theo cây trồng"),
    thi_truong: Optional[str] = Query(None, description="Lọc theo thị trường"),
    include_deleted: bool = Query(False, description="Bao gồm cả các bản ghi đã xóa mềm"),
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Dành riêng cho Quản trị viên:
    - Hiển thị đầy đủ số điện thoại và email của người đại diện.
    - Hỗ trợ lọc hoặc hiển thị bản ghi đã xóa mềm.
    """
    query = db.query(VungTrong)

    if not include_deleted:
        query = query.filter(VungTrong.is_deleted == False)

    if msvt:
        search_kw = f"%{msvt.strip()}%"
        query = query.filter(or_(VungTrong.msvt_moi.ilike(search_kw), VungTrong.msvt_cu.ilike(search_kw)))

    if loai_cay:
        query = query.filter(VungTrong.loai_cay_trong.ilike(f"%{loai_cay.strip()}%"))

    if thi_truong:
        query = query.filter(VungTrong.thi_truong.ilike(f"%{thi_truong.strip()}%"))

    total = query.count()
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    records = query.order_by(VungTrong.id.asc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for r in records:
        geom_type = "MULTIPOLYGON" if r.ranh_gioi is not None else ("POINT" if r.vi_tri is not None else None)
        items.append(AdminRegionDetail(
            id=r.id,
            msvt_moi=r.msvt_moi,
            msvt_cu=r.msvt_cu,
            to_chuc_ca_nhan=r.to_chuc_ca_nhan,
            nguoi_dai_dien=r.nguoi_dai_dien,
            so_dien_thoai=r.so_dien_thoai,
            email=r.email,
            toa_do_goc=r.toa_do_goc,
            dia_chi_msvt=r.dia_chi_msvt,
            loai_cay_trong=r.loai_cay_trong,
            so_ho_tham_gia=r.so_ho_tham_gia,
            dien_tich_ha=float(r.dien_tich_ha) if r.dien_tich_ha is not None else None,
            san_luong_tan_ha=float(r.san_luong_tan_ha) if r.san_luong_tan_ha is not None else None,
            tong_san_luong_tan=float(r.tong_san_luong_tan) if r.tong_san_luong_tan is not None else None,
            quy_trinh=r.quy_trinh,
            thi_truong=r.thi_truong,
            geometry_type=geom_type,
            created_at=r.created_at,
            updated_at=r.updated_at,
            is_deleted=r.is_deleted,
            deleted_at=r.deleted_at,
            deleted_by=r.deleted_by
        ))

    return AdminPaginatedRegionsResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=items
    )


@router.post(
    "/regions/validate-geometry",
    response_model=GeometryValidationResponse,
    summary="[GIS] Kiểm tra tính hợp lệ hình học PostGIS và đối chiếu diện tích WGS84"
)
def validate_geometry_endpoint(
    payload: GeometryValidationRequest,
    db: Session = Depends(get_db)
):
    """
    Sử dụng PostGIS:
    - ST_IsValid: Kiểm tra hình học có tự cắt hoặc lỗi topology không
    - ST_IsValidReason: Trả về chi tiết lý do và tọa độ giao cắt nếu lỗi
    - ST_Area(ranh_gioi::geography) / 10000.0: Tính diện tích bằng ha trên WGS84 ellipsoid
    - Đối chiếu với diện tích hồ sơ (ha) và phân loại sai lệch
    """
    import json
    geom_json_str = json.dumps(payload.geojson)

    try:
        check_query = text(
            "SELECT ST_IsValid(ST_GeomFromGeoJSON(:geom)), "
            "ST_IsValidReason(ST_GeomFromGeoJSON(:geom))"
        )
        row = db.execute(check_query, {"geom": geom_json_str}).fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="Không thể xử lý dữ liệu GeoJSON.")

        is_valid = bool(row[0])
        reason = str(row[1]) if row[1] else ("Valid Geometry" if is_valid else "Invalid Geometry")

        area_ha = None
        diff_ha = None
        deviation_pct = None
        rating = "INVALID" if not is_valid else "NO_DECLARED"
        label = "Hình học không hợp lệ" if not is_valid else "Chưa có diện tích hồ sơ"

        if is_valid:
            area_query = text("SELECT ST_Area(ST_GeomFromGeoJSON(:geom)::geography) / 10000.0")
            area_row = db.execute(area_query, {"geom": geom_json_str}).fetchone()
            if area_row and area_row[0] is not None:
                area_ha = round(float(area_row[0]), 4)

            decl = payload.declared_area_ha
            if decl is not None and decl > 0 and area_ha is not None:
                diff_ha = round(abs(area_ha - decl), 4)
                deviation_pct = round((diff_ha / decl) * 100.0, 2)
                if deviation_pct <= 10.0:
                    rating = "CLOSE"
                    label = "Gần diện tích khai báo"
                elif deviation_pct <= 25.0:
                    rating = "REVIEW"
                    label = "Cần rà soát"
                else:
                    rating = "WARNING"
                    label = "Cảnh báo sai lệch lớn"

        return GeometryValidationResponse(
            is_valid=is_valid,
            reason=reason,
            area_ha=area_ha,
            diff_ha=diff_ha,
            deviation_pct=deviation_pct,
            rating=rating,
            label=label
        )
    except Exception as e:
        logger.warning(f"Lỗi khi kiểm tra geometry PostGIS: {e}")
        return GeometryValidationResponse(
            is_valid=False,
            reason=f"Lỗi GeoJSON: {str(e)}",
            area_ha=None,
            diff_ha=None,
            deviation_pct=None,
            rating="INVALID",
            label="Lỗi định dạng GeoJSON"
        )


@router.post(
    "/regions/parse-coordinates",
    summary="[GIS] Phân tích cú pháp tọa độ GPS thông minh (Đánh số đỉnh Đ1..Đn, hướng N/E, đa nhóm)"
)
def parse_coordinates_endpoint(
    payload: ParseCoordinatesRequest
):
    """
    Phân tích chuỗi tọa độ GPS nguồn:
    - Nhận diện nhãn điểm Đ1..Đn, P1..Pn, Điểm 1..Điểm n
    - Tự động nhận diện hướng N/S/E/W và hoán đổi đúng thứ tự vĩ độ/kinh độ
    - Chuẩn hóa khoảng trắng bất thường trong số thập phân
    - Phân chia nhiều nhóm ranh giới độc lập
    - Kiểm định hình học từng nhóm (Tự cắt, dải hẹp, diện tích trắc địa WGS84)
    """
    from ..coord_parser import parse_and_validate_coordinates
    return parse_and_validate_coordinates(payload.raw_text)


@router.get(
    "/admin/regions/{id}",
    response_model=AdminRegionDetail,
    summary="[Admin] Xem chi tiết một vùng trồng (kể cả đã xóa mềm)"
)
def admin_get_region_detail(
    id: int,
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    region = db.query(VungTrong).filter(VungTrong.id == id).first()
    if not region:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy vùng trồng với ID={id}")

    geom_type = "MULTIPOLYGON" if region.ranh_gioi is not None else ("POINT" if region.vi_tri is not None else None)

    return AdminRegionDetail(
        id=region.id,
        msvt_moi=region.msvt_moi,
        msvt_cu=region.msvt_cu,
        to_chuc_ca_nhan=region.to_chuc_ca_nhan,
        nguoi_dai_dien=region.nguoi_dai_dien,
        so_dien_thoai=region.so_dien_thoai,
        email=region.email,
        toa_do_goc=region.toa_do_goc,
        dia_chi_msvt=region.dia_chi_msvt,
        loai_cay_trong=region.loai_cay_trong,
        so_ho_tham_gia=region.so_ho_tham_gia,
        dien_tich_ha=float(region.dien_tich_ha) if region.dien_tich_ha is not None else None,
        san_luong_tan_ha=float(region.san_luong_tan_ha) if region.san_luong_tan_ha is not None else None,
        tong_san_luong_tan=float(region.tong_san_luong_tan) if region.tong_san_luong_tan is not None else None,
        quy_trinh=region.quy_trinh,
        thi_truong=region.thi_truong,
        geometry_type=geom_type,
        geometry=get_geojson_geometry(region),
        created_at=region.created_at,
        updated_at=region.updated_at,
        is_deleted=region.is_deleted,
        deleted_at=region.deleted_at,
        deleted_by=region.deleted_by
    )


@router.post(
    "/regions",
    response_model=AdminRegionDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf)],
    summary="[Admin] Thêm mới một vùng trồng MSVT"
)
def create_region(
    payload: RegionCreate,
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Thêm mới vùng trồng:
    - Bắt buộc quyền Admin.
    - Kiểm tra CSRF nếu dùng cookie.
    - Kiểm tra trùng lặp mã MSVT (trả về 409 Conflict nếu trùng).
    - Chuyển đổi và kiểm tra tính hợp lệ của GIS geometry.
    - Đảm bảo rollback khi có lỗi.
    - Logging bảo mật (không lộ SĐT/Email/Token).
    """
    # 1. Kiểm tra trùng lặp mã MSVT
    check_duplicate_msvt(db, payload.msvt_moi, payload.msvt_cu)

    # 2. Xử lý dữ liệu không gian GIS (Bắt buộc phải có Point hoặc Polygon hợp lệ đã xác nhận)
    vi_tri, ranh_gioi, _ = validate_strict_geometry(db, payload.geometry, is_create=True, existing_has_geom=False)

    try:
        new_region = VungTrong(
            msvt_moi=payload.msvt_moi,
            msvt_cu=payload.msvt_cu,
            to_chuc_ca_nhan=payload.to_chuc_ca_nhan,
            nguoi_dai_dien=payload.nguoi_dai_dien,
            so_dien_thoai=payload.so_dien_thoai,
            email=payload.email,
            toa_do_goc=payload.toa_do_goc,
            dia_chi_msvt=payload.dia_chi_msvt,
            loai_cay_trong=payload.loai_cay_trong,
            so_ho_tham_gia=payload.so_ho_tham_gia,
            dien_tich_ha=payload.dien_tich_ha,
            tong_san_luong_tan=payload.tong_san_luong_tan,
            san_luong_tan_ha=payload.san_luong_tan_ha,
            quy_trinh=payload.quy_trinh,
            thi_truong=payload.thi_truong,
            vi_tri=vi_tri,
            ranh_gioi=ranh_gioi,
            is_deleted=False
        )

        db.add(new_region)
        db.commit()
        db.refresh(new_region)

        # Logging an toàn (Không log phone, email hay token)
        logger.info(
            f"Admin '{current_user.username}' (ID={current_user.id}) đã tạo mới vùng trồng MSVT ID={new_region.id}, "
            f"Mã MSVT='{new_region.msvt_moi or new_region.msvt_cu or 'N/A'}'."
        )

        geom_type = "MULTIPOLYGON" if new_region.ranh_gioi is not None else ("POINT" if new_region.vi_tri is not None else None)

        return AdminRegionDetail(
            id=new_region.id,
            msvt_moi=new_region.msvt_moi,
            msvt_cu=new_region.msvt_cu,
            to_chuc_ca_nhan=new_region.to_chuc_ca_nhan,
            nguoi_dai_dien=new_region.nguoi_dai_dien,
            so_dien_thoai=new_region.so_dien_thoai,
            email=new_region.email,
            toa_do_goc=new_region.toa_do_goc,
            dia_chi_msvt=new_region.dia_chi_msvt,
            loai_cay_trong=new_region.loai_cay_trong,
            so_ho_tham_gia=new_region.so_ho_tham_gia,
            dien_tich_ha=float(new_region.dien_tich_ha) if new_region.dien_tich_ha is not None else None,
            san_luong_tan_ha=float(new_region.san_luong_tan_ha) if new_region.san_luong_tan_ha is not None else None,
            tong_san_luong_tan=float(new_region.tong_san_luong_tan) if new_region.tong_san_luong_tan is not None else None,
            quy_trinh=new_region.quy_trinh,
            thi_truong=new_region.thi_truong,
            geometry_type=geom_type,
            geometry=get_geojson_geometry(new_region),
            created_at=new_region.created_at,
            updated_at=new_region.updated_at,
            is_deleted=new_region.is_deleted,
            deleted_at=new_region.deleted_at,
            deleted_by=new_region.deleted_by
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Lỗi khi thêm mới vùng trồng: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Đã xảy ra lỗi máy chủ khi thêm mới vùng trồng."
        )


@router.put(
    "/regions/{id}",
    response_model=AdminRegionDetail,
    dependencies=[Depends(require_csrf)],
    summary="[Admin] Cập nhật toàn bộ (PUT) thông tin vùng trồng MSVT"
)
def update_region(
    id: int,
    payload: RegionUpdate,
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Cập nhật toàn bộ thông tin một vùng trồng:
    - Thay thế toàn bộ các trường nghiệp vụ và hình học.
    - Kiểm tra trùng lặp MSVT với các bản ghi khác (409 Conflict).
    - Cập nhật GIS geometry tương ứng.
    """
    region = db.query(VungTrong).filter(VungTrong.id == id, VungTrong.is_deleted == False).first()
    if not region:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy vùng trồng với ID={id}")

    # 1. Kiểm tra trùng lặp mã MSVT
    check_duplicate_msvt(db, payload.msvt_moi, payload.msvt_cu, exclude_id=id)

    # 2. Xử lý GIS geometry mới
    existing_has_geom = (region.vi_tri is not None or region.ranh_gioi is not None)
    if payload.geometry is not None:
        vi_tri, ranh_gioi, keep_old = validate_strict_geometry(db, payload.geometry, is_create=False, existing_has_geom=existing_has_geom)
        if not keep_old:
            region.vi_tri = vi_tri
            region.ranh_gioi = ranh_gioi
    else:
        if not existing_has_geom:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "MISSING_GEOMETRY",
                    "message": "Vùng trồng này hiện chưa có dữ liệu không gian. Ở chế độ kiểm soát nghiêm ngặt, bắt buộc phải bổ sung Point hoặc Polygon hợp lệ trước khi lưu cập nhật.",
                    "reason": "Existing record has no geometry"
                }
            )
        # Giữ nguyên geometry cũ

    try:
        region.msvt_moi = payload.msvt_moi
        region.msvt_cu = payload.msvt_cu
        region.to_chuc_ca_nhan = payload.to_chuc_ca_nhan
        region.nguoi_dai_dien = payload.nguoi_dai_dien
        region.so_dien_thoai = payload.so_dien_thoai
        region.email = payload.email
        region.toa_do_goc = payload.toa_do_goc
        region.dia_chi_msvt = payload.dia_chi_msvt
        region.loai_cay_trong = payload.loai_cay_trong
        region.so_ho_tham_gia = payload.so_ho_tham_gia
        region.dien_tich_ha = payload.dien_tich_ha
        region.tong_san_luong_tan = payload.tong_san_luong_tan
        region.san_luong_tan_ha = payload.san_luong_tan_ha
        region.quy_trinh = payload.quy_trinh
        region.thi_truong = payload.thi_truong

        db.commit()
        db.refresh(region)

        logger.info(
            f"Admin '{current_user.username}' (ID={current_user.id}) đã cập nhật (PUT) vùng trồng ID={region.id}, "
            f"Mã MSVT='{region.msvt_moi or region.msvt_cu or 'N/A'}'."
        )

        geom_type = "MULTIPOLYGON" if region.ranh_gioi is not None else ("POINT" if region.vi_tri is not None else None)

        return AdminRegionDetail(
            id=region.id,
            msvt_moi=region.msvt_moi,
            msvt_cu=region.msvt_cu,
            to_chuc_ca_nhan=region.to_chuc_ca_nhan,
            nguoi_dai_dien=region.nguoi_dai_dien,
            so_dien_thoai=region.so_dien_thoai,
            email=region.email,
            toa_do_goc=region.toa_do_goc,
            dia_chi_msvt=region.dia_chi_msvt,
            loai_cay_trong=region.loai_cay_trong,
            so_ho_tham_gia=region.so_ho_tham_gia,
            dien_tich_ha=float(region.dien_tich_ha) if region.dien_tich_ha is not None else None,
            san_luong_tan_ha=float(region.san_luong_tan_ha) if region.san_luong_tan_ha is not None else None,
            tong_san_luong_tan=float(region.tong_san_luong_tan) if region.tong_san_luong_tan is not None else None,
            quy_trinh=region.quy_trinh,
            thi_truong=region.thi_truong,
            geometry_type=geom_type,
            geometry=get_geojson_geometry(region),
            created_at=region.created_at,
            updated_at=region.updated_at,
            is_deleted=region.is_deleted,
            deleted_at=region.deleted_at,
            deleted_by=region.deleted_by
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Lỗi khi cập nhật (PUT) vùng trồng ID={id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Đã xảy ra lỗi máy chủ khi cập nhật vùng trồng."
        )


@router.patch(
    "/regions/{id}",
    response_model=AdminRegionDetail,
    dependencies=[Depends(require_csrf)],
    summary="[Admin] Cập nhật từng phần (PATCH) thông tin vùng trồng MSVT"
)
def patch_region(
    id: int,
    payload: RegionPatch,
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Cập nhật từng phần một vùng trồng:
    - Chỉ cập nhật các trường được chỉ định trong payload.
    - NẾU KHÔNG GỬI TRƯỜNG GEOMETRY, BẢO TOÀN NGUYÊN VẸN HÌNH HỌC CŨ.
    - Kiểm tra trùng lặp MSVT nếu có thay đổi mã.
    """
    region = db.query(VungTrong).filter(VungTrong.id == id, VungTrong.is_deleted == False).first()
    if not region:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy vùng trồng với ID={id}")

    # Lấy các trường thực sự được gửi từ client
    fields_set = payload.model_dump(exclude_unset=True)

    # 1. Kiểm tra trùng lặp nếu có thay đổi mã
    if "msvt_moi" in fields_set or "msvt_cu" in fields_set:
        new_msvt_moi = fields_set.get("msvt_moi", region.msvt_moi)
        new_msvt_cu = fields_set.get("msvt_cu", region.msvt_cu)
        check_duplicate_msvt(db, new_msvt_moi, new_msvt_cu, exclude_id=id)

    try:
        # 2. Cập nhật các trường thuộc tính thông thường
        for field, value in fields_set.items():
            if field == "geometry":
                continue
            setattr(region, field, value)

        existing_has_geom = (region.vi_tri is not None or region.ranh_gioi is not None)

        # 3. QUY TẮC QUAN TRỌNG: Chỉ xử lý hình học nếu client thực sự gửi trường 'geometry'
        if "geometry" in fields_set:
            if payload.geometry is None:
                # Chặn tuyệt đối thao tác xóa geometry (Section VIII.D & Section X)
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "CANNOT_DELETE_GEOMETRY",
                        "message": "Không cho phép xóa bỏ dữ liệu hình học trong quy trình Thêm/Sửa thông thường theo chế độ kiểm soát nghiêm ngặt.",
                        "reason": "Geometry deletion not permitted"
                    }
                )
            vi_tri, ranh_gioi, keep_old = validate_strict_geometry(db, payload.geometry, is_create=False, existing_has_geom=existing_has_geom)
            if not keep_old:
                region.vi_tri = vi_tri
                region.ranh_gioi = ranh_gioi
        else:
            # Nếu không gửi trường geometry:
            # Nếu bản ghi cũ CHƯA có geometry (Case E: ID 50, 51), từ chối cập nhật thuộc tính cho đến khi bổ sung tọa độ hợp lệ
            if not existing_has_geom:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "MISSING_GEOMETRY",
                        "message": "Vùng trồng này hiện chưa có dữ liệu không gian. Ở chế độ kiểm soát nghiêm ngặt, bắt buộc phải bổ sung Point hoặc Polygon hợp lệ trước khi lưu cập nhật.",
                        "reason": "Existing record has no geometry"
                    }
                )
            # Bản ghi cũ đã có geometry hợp lệ -> bảo toàn 100% hình học cũ

        db.commit()
        db.refresh(region)

        logger.info(
            f"Admin '{current_user.username}' (ID={current_user.id}) đã cập nhật từng phần (PATCH) vùng trồng ID={region.id}, "
            f"các trường: {list(fields_set.keys())}."
        )

        geom_type = "MULTIPOLYGON" if region.ranh_gioi is not None else ("POINT" if region.vi_tri is not None else None)

        return AdminRegionDetail(
            id=region.id,
            msvt_moi=region.msvt_moi,
            msvt_cu=region.msvt_cu,
            to_chuc_ca_nhan=region.to_chuc_ca_nhan,
            nguoi_dai_dien=region.nguoi_dai_dien,
            so_dien_thoai=region.so_dien_thoai,
            email=region.email,
            toa_do_goc=region.toa_do_goc,
            dia_chi_msvt=region.dia_chi_msvt,
            loai_cay_trong=region.loai_cay_trong,
            so_ho_tham_gia=region.so_ho_tham_gia,
            dien_tich_ha=float(region.dien_tich_ha) if region.dien_tich_ha is not None else None,
            san_luong_tan_ha=float(region.san_luong_tan_ha) if region.san_luong_tan_ha is not None else None,
            tong_san_luong_tan=float(region.tong_san_luong_tan) if region.tong_san_luong_tan is not None else None,
            quy_trinh=region.quy_trinh,
            thi_truong=region.thi_truong,
            geometry_type=geom_type,
            geometry=get_geojson_geometry(region),
            created_at=region.created_at,
            updated_at=region.updated_at,
            is_deleted=region.is_deleted,
            deleted_at=region.deleted_at,
            deleted_by=region.deleted_by
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Lỗi khi cập nhật (PATCH) vùng trồng ID={id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Đã xảy ra lỗi máy chủ khi cập nhật vùng trồng."
        )


@router.delete(
    "/regions/{id}",
    dependencies=[Depends(require_csrf)],
    summary="[Admin] Xóa mềm (Soft Delete) một vùng trồng MSVT"
)
def delete_region(
    id: int,
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Xóa mềm vùng trồng MSVT:
    - is_deleted = TRUE
    - deleted_at = CURRENT_TIMESTAMP
    - deleted_by = ID của tài khoản Admin hiện tại
    Không xóa vĩnh viễn khỏi CSDL, bảo toàn dữ liệu lịch sử.
    Bản ghi bị xóa sẽ ngay lập tức biến mất khỏi các API công khai (bản đồ, danh sách, thống kê).
    """
    region = db.query(VungTrong).filter(VungTrong.id == id, VungTrong.is_deleted == False).first()
    if not region:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy vùng trồng với ID={id} (hoặc đã bị xóa trước đó).")

    try:
        now = datetime.now(timezone.utc)
        region.is_deleted = True
        region.deleted_at = now
        region.deleted_by = current_user.id

        db.commit()

        logger.info(
            f"Admin '{current_user.username}' (ID={current_user.id}) đã xóa mềm vùng trồng ID={region.id}, "
            f"Mã MSVT='{region.msvt_moi or region.msvt_cu or 'N/A'}'."
        )

        return {
            "message": "Xóa mềm vùng trồng thành công.",
            "id": region.id,
            "deleted_at": now.isoformat(),
            "deleted_by": current_user.id
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Lỗi khi xóa mềm vùng trồng ID={id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Đã xảy ra lỗi máy chủ khi xóa vùng trồng."
        )
