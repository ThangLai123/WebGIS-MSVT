import json
import math
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import text, or_

from ..database import get_db
from ..models import VungTrong
from ..schemas import (
    PaginatedRegionsResponse,
    RegionListItem,
    RegionDetail,
    GeoJSONFeatureCollection,
    GeoJSONFeature,
    StatisticsResponse,
    GeometryStats
)

router = APIRouter(prefix="/api", tags=["Vùng Trồng MSVT"])


@router.get("/regions", response_model=PaginatedRegionsResponse, summary="Danh sách vùng trồng (có phân trang và bộ lọc)")
def get_regions(
    page: int = Query(1, ge=1, description="Số thứ tự trang (bắt đầu từ 1)"),
    page_size: int = Query(20, ge=1, le=100, description="Số bản ghi trên mỗi trang (tối đa 100)"),
    msvt: Optional[str] = Query(None, description="Lọc theo mã MSVT mới hoặc cũ"),
    loai_cay: Optional[str] = Query(None, description="Lọc theo loại cây trồng"),
    thi_truong: Optional[str] = Query(None, description="Lọc theo thị trường"),
    db: Session = Depends(get_db)
):
    query = db.query(VungTrong)

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
    - Sử dụng ST_AsGeoJSON chuyển đổi hình học PostGIS sang GeoJSON chuẩn [longitude, latitude].
    - Ưu tiên hiển thị ranh_gioi (MultiPolygon), nếu không có thì dùng vi_tri (Point).
    - Loại bỏ hoàn toàn các bản ghi không có hình học (9 bản ghi lỗi/thiếu).
    - Không công khai số điện thoại và email cá nhân trong properties.
    """
    sql = text("""
        SELECT 
            id, msvt_moi, msvt_cu, to_chuc_ca_nhan, nguoi_dai_dien,
            dia_chi_msvt, loai_cay_trong, so_ho_tham_gia, dien_tich_ha,
            tong_san_luong_tan, quy_trinh, thi_truong,
            CASE WHEN ranh_gioi IS NOT NULL THEN 'MULTIPOLYGON' ELSE 'POINT' END AS geom_type,
            ST_AsGeoJSON(COALESCE(ranh_gioi, vi_tri)) AS geojson_geom
        FROM public.vung_trong
        WHERE vi_tri IS NOT NULL OR ranh_gioi IS NOT NULL
        ORDER BY id ASC;
    """)

    results = db.execute(sql).fetchall()

    features = []
    for row in results:
        if not row.geojson_geom:
            continue
        geom_dict = json.loads(row.geojson_geom)
        properties = {
            "id": row.id,
            "msvt_moi": row.msvt_moi,
            "msvt_cu": row.msvt_cu,
            "to_chuc_ca_nhan": row.to_chuc_ca_nhan,
            "nguoi_dai_dien": row.nguoi_dai_dien,
            "dia_chi_msvt": row.dia_chi_msvt,
            "loai_cay_trong": row.loai_cay_trong,
            "so_ho_tham_gia": row.so_ho_tham_gia,
            "dien_tich_ha": float(row.dien_tich_ha) if row.dien_tich_ha is not None else None,
            "tong_san_luong_tan": float(row.tong_san_luong_tan) if row.tong_san_luong_tan is not None else None,
            "quy_trinh": row.quy_trinh,
            "thi_truong": row.thi_truong,
            "geom_type": row.geom_type,
            "verification_status": "Chưa xác minh thực địa" if row.geom_type == "MULTIPOLYGON" else "Điểm mốc đại diện"
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
    Sử dụng hàm PostGIS ST_Covers để tìm vùng trồng có đa giác ranh_gioi bao phủ điểm (lng, lat).
    Không sử dụng điểm Point để tra cứu bao phủ. Nếu không có vùng nào bao trùm, trả về danh sách rỗng [].
    """
    sql = text("""
        SELECT 
            id, msvt_moi, msvt_cu, to_chuc_ca_nhan, nguoi_dai_dien,
            dia_chi_msvt, loai_cay_trong, so_ho_tham_gia, dien_tich_ha,
            tong_san_luong_tan, quy_trinh, thi_truong,
            ST_AsGeoJSON(ranh_gioi) AS geojson_geom
        FROM public.vung_trong
        WHERE ranh_gioi IS NOT NULL
          AND ST_Covers(ranh_gioi, ST_SetSRID(ST_Point(:lng, :lat), 4326))
        ORDER BY id ASC;
    """)

    results = db.execute(sql, {"lng": lng, "lat": lat}).fetchall()

    items = []
    for row in results:
        items.append({
            "id": row.id,
            "msvt_moi": row.msvt_moi,
            "msvt_cu": row.msvt_cu,
            "to_chuc_ca_nhan": row.to_chuc_ca_nhan,
            "nguoi_dai_dien": row.nguoi_dai_dien,
            "dia_chi_msvt": row.dia_chi_msvt,
            "loai_cay_trong": row.loai_cay_trong,
            "so_ho_tham_gia": row.so_ho_tham_gia,
            "dien_tich_ha": float(row.dien_tich_ha) if row.dien_tich_ha is not None else None,
            "tong_san_luong_tan": float(row.tong_san_luong_tan) if row.tong_san_luong_tan is not None else None,
            "quy_trinh": row.quy_trinh,
            "thi_truong": row.thi_truong,
            "geometry": json.loads(row.geojson_geom) if row.geojson_geom else None
        })

    return items


@router.get("/statistics", response_model=StatisticsResponse, summary="Thống kê tổng hợp số liệu vùng trồng và hình học")
def get_statistics(db: Session = Depends(get_db)):
    # 1. Thống kê tổng số và hình học
    sql_overview = text("""
        SELECT 
            COUNT(*) AS total_regions,
            COALESCE(SUM(dien_tich_ha), 0) AS total_area,
            COALESCE(SUM(tong_san_luong_tan), 0) AS total_yield,
            COUNT(vi_tri) AS point_count,
            COUNT(ranh_gioi) AS poly_count,
            COUNT(*) - COUNT(vi_tri) - COUNT(ranh_gioi) AS without_geom_count
        FROM public.vung_trong;
    """)
    overview = db.execute(sql_overview).fetchone()

    # 2. Thống kê theo loại cây trồng
    sql_crop = text("""
        SELECT COALESCE(loai_cay_trong, 'Chưa xác định') AS loai_cay, COUNT(*) AS count
        FROM public.vung_trong
        GROUP BY loai_cay_trong
        ORDER BY count DESC;
    """)
    crops = db.execute(sql_crop).fetchall()
    by_crop = {row.loai_cay: row.count for row in crops}

    # 3. Thống kê theo thị trường
    sql_market = text("""
        SELECT COALESCE(thi_truong, 'Chưa xác định') AS thi_truong, COUNT(*) AS count
        FROM public.vung_trong
        GROUP BY thi_truong
        ORDER BY count DESC;
    """)
    markets = db.execute(sql_market).fetchall()
    by_market = {row.thi_truong: row.count for row in markets}

    return StatisticsResponse(
        total_regions=overview.total_regions,
        total_area_ha=round(float(overview.total_area), 4),
        total_recorded_yield_tons=round(float(overview.total_yield), 4),
        by_crop_type=by_crop,
        by_market=by_market,
        geometry_stats=GeometryStats(
            point_count=overview.point_count,
            multipolygon_count=overview.poly_count,
            without_geometry_count=overview.without_geom_count
        )
    )


@router.get("/regions/{id}", response_model=RegionDetail, summary="Xem thông tin chi tiết một vùng trồng theo ID")
def get_region_detail(id: int, db: Session = Depends(get_db)):
    region = db.query(VungTrong).filter(VungTrong.id == id).first()
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
        created_at=region.created_at,
        updated_at=region.updated_at
    )
