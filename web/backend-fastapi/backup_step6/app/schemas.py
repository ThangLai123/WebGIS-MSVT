from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class RegionListItem(BaseModel):
    """Schema danh sách vùng trồng công khai (Ẩn dữ liệu nhạy cảm SĐT, Email)"""
    id: int
    msvt_moi: Optional[str] = None
    msvt_cu: Optional[str] = None
    to_chuc_ca_nhan: Optional[str] = None
    nguoi_dai_dien: Optional[str] = None
    dia_chi_msvt: Optional[str] = None
    loai_cay_trong: Optional[str] = None
    so_ho_tham_gia: Optional[int] = None
    dien_tich_ha: Optional[float] = None
    tong_san_luong_tan: Optional[float] = None
    quy_trinh: Optional[str] = None
    thi_truong: Optional[str] = None
    has_geometry: bool
    geometry_type: Optional[str] = None  # 'POINT', 'MULTIPOLYGON', None

    model_config = ConfigDict(from_attributes=True)


class RegionDetail(BaseModel):
    """Schema chi tiết đầy đủ của một vùng trồng"""
    id: int
    msvt_moi: Optional[str] = None
    msvt_cu: Optional[str] = None
    to_chuc_ca_nhan: Optional[str] = None
    nguoi_dai_dien: Optional[str] = None
    so_dien_thoai: Optional[str] = None
    email: Optional[str] = None
    toa_do_goc: Optional[str] = None
    dia_chi_msvt: Optional[str] = None
    loai_cay_trong: Optional[str] = None
    so_ho_tham_gia: Optional[int] = None
    dien_tich_ha: Optional[float] = None
    san_luong_tan_ha: Optional[float] = None
    tong_san_luong_tan: Optional[float] = None
    quy_trinh: Optional[str] = None
    thi_truong: Optional[str] = None
    geometry_type: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PaginatedRegionsResponse(BaseModel):
    """Phản hồi phân trang danh sách vùng trồng"""
    total: int = Field(..., description="Tổng số bản ghi thỏa mãn điều kiện lọc")
    page: int = Field(..., description="Số thứ tự trang hiện tại")
    page_size: int = Field(..., description="Số bản ghi trên mỗi trang")
    total_pages: int = Field(..., description="Tổng số trang")
    items: List[RegionListItem]


class GeoJSONFeature(BaseModel):
    """Cấu trúc một Feature theo chuẩn RFC 7946 GeoJSON"""
    type: str = "Feature"
    geometry: Dict[str, Any]
    properties: Dict[str, Any]


class GeoJSONFeatureCollection(BaseModel):
    """Cấu trúc FeatureCollection chuẩn GeoJSON"""
    type: str = "FeatureCollection"
    features: List[GeoJSONFeature]


class GeometryStats(BaseModel):
    point_count: int
    multipolygon_count: int
    without_geometry_count: int


class StatisticsResponse(BaseModel):
    """Thống kê tổng hợp dữ liệu MSVT"""
    total_regions: int
    total_area_ha: float
    total_recorded_yield_tons: float
    yield_unit_note: str = "Giá trị lưu trữ từ Cột 13 Excel, chưa xác minh đơn vị chính thức"
    by_crop_type: Dict[str, int]
    by_market: Dict[str, int]
    geometry_stats: GeometryStats
