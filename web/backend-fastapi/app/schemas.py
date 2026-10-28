import re
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


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
    geometry: Optional[Dict[str, Any]] = None
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


# ==============================================================================
# Schemas Xác thực & Phân quyền Quản trị (Auth & Authorization)
# ==============================================================================
class LoginRequest(BaseModel):
    """Dữ liệu yêu cầu đăng nhập"""
    username: str = Field(..., min_length=3, max_length=50, description="Tên đăng nhập")
    password: str = Field(..., min_length=6, description="Mật khẩu tài khoản")


class UserResponse(BaseModel):
    """Thông tin tài khoản an toàn trả về cho client (Tuyệt đối không chứa password_hash)"""
    id: int
    username: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class LoginResponse(BaseModel):
    """Phản hồi sau khi đăng nhập thành công"""
    message: str = "Đăng nhập thành công"
    user: UserResponse
    csrf_token: str


class LogoutResponse(BaseModel):
    """Phản hồi khi đăng xuất"""
    message: str = "Đăng xuất thành công"


class VerifyAdminResponse(BaseModel):
    """Phản hồi kiểm tra quyền quản trị Admin"""
    status: str = "authorized"
    role: str
    username: str


# ==============================================================================
# Schemas Quản lý Vùng trồng MSVT dành cho Quản trị viên (Admin CRUD)
# ==============================================================================
class PointCoordinates(BaseModel):
    """Tọa độ điểm mốc đại diện (Point) theo hệ quy chiếu WGS84 (EPSG:4326)"""
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Kinh độ [-180, 180]")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Vĩ độ [-90, 90]")

    @model_validator(mode="before")
    @classmethod
    def normalize_lat_lng(cls, data: Any) -> Any:
        if isinstance(data, dict):
            lat = data.get("latitude") if "latitude" in data else data.get("lat")
            lng = data.get("longitude") if "longitude" in data else (data.get("lng") if "lng" in data else data.get("lon"))
            if lat is not None and lng is not None:
                return {
                    "latitude": float(lat),
                    "longitude": float(lng)
                }
        return data


class GeometryInput(BaseModel):
    """
    Dữ liệu hình học gửi lên từ client:
    - Có thể gửi Point (kinh độ, vĩ độ)
    - HOẶC gửi GeoJSON Polygon / MultiPolygon
    - Cho phép cả hai đều None nếu vùng trồng chưa có tọa độ
    """
    point: Optional[PointCoordinates] = None
    geojson: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def normalize_geometry_input(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Nếu client gửi trực tiếp { "latitude": ..., "longitude": ... } hoặc { "lat": ..., "lng": ... }
            if "point" not in data and "geojson" not in data:
                lat = data.get("latitude") if "latitude" in data else data.get("lat")
                lng = data.get("longitude") if "longitude" in data else (data.get("lng") if "lng" in data else data.get("lon"))
                if lat is not None and lng is not None:
                    try:
                        return {"point": {"latitude": float(lat), "longitude": float(lng)}}
                    except (ValueError, TypeError):
                        pass
                if "type" in data and "coordinates" in data:
                    return {"geojson": data}
            # Nếu cả point và geojson cùng được gửi và geojson là Point, ưu tiên point
            if data.get("point") is not None and data.get("geojson") is not None:
                gtype = data["geojson"].get("type") if isinstance(data["geojson"], dict) else None
                if gtype == "Point":
                    return {"point": data["point"]}
        return data

    @field_validator("geojson")
    @classmethod
    def validate_geojson(cls, v):
        if v is not None:
            if not isinstance(v, dict):
                raise ValueError("GeoJSON geometry phải là một đối tượng JSON (dictionary).")
            gtype = v.get("type")
            if gtype not in ("Point", "Polygon", "MultiPolygon"):
                raise ValueError(f"Kiểu hình học GeoJSON '{gtype}' không được hỗ trợ. Chỉ hỗ trợ Point, Polygon hoặc MultiPolygon.")
            coords = v.get("coordinates")
            if coords is None or not isinstance(coords, list):
                raise ValueError("GeoJSON phải chứa mảng tọa độ 'coordinates' hợp lệ.")
        return v


class GeometryValidationRequest(BaseModel):
    geojson: Dict[str, Any]
    declared_area_ha: Optional[float] = Field(None, ge=0.0)

    model_config = ConfigDict(extra="forbid")


class GeometryValidationResponse(BaseModel):
    is_valid: bool
    reason: str
    area_ha: Optional[float] = None
    diff_ha: Optional[float] = None
    deviation_pct: Optional[float] = None
    rating: str
    label: str


class ParseCoordinatesRequest(BaseModel):
    raw_text: str
    declared_area_ha: Optional[float] = Field(None, ge=0.0)

    model_config = ConfigDict(extra="forbid")


class RegionBase(BaseModel):
    msvt_moi: Optional[str] = None
    msvt_cu: Optional[str] = None
    to_chuc_ca_nhan: Optional[str] = None
    nguoi_dai_dien: Optional[str] = None
    so_dien_thoai: Optional[str] = None
    email: Optional[str] = None
    toa_do_goc: Optional[str] = None
    dia_chi_msvt: Optional[str] = None
    loai_cay_trong: Optional[str] = None
    so_ho_tham_gia: Optional[int] = Field(None, ge=0, description="Số hộ tham gia (không âm)")
    dien_tich_ha: Optional[float] = Field(None, ge=0.0, description="Diện tích ha (không âm)")
    tong_san_luong_tan: Optional[float] = Field(None, ge=0.0, description="Tổng sản lượng tấn (không âm)")
    san_luong_tan_ha: Optional[float] = Field(None, ge=0.0, description="Năng suất tấn/ha (không âm)")
    quy_trinh: Optional[str] = None
    thi_truong: Optional[str] = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("msvt_moi", "msvt_cu", mode="before")
    @classmethod
    def validate_msvt_code(cls, v):
        if v is not None:
            v_str = str(v).strip()
            return v_str if v_str else None
        return None

    @field_validator("email", mode="before")
    @classmethod
    def validate_email_format(cls, v):
        if v is not None:
            v_str = str(v).strip()
            if not v_str:
                return None
            if "@" not in v_str or "." not in v_str:
                raise ValueError("Định dạng email không hợp lệ (cần chứa ký tự @ và tên miền).")
            return v_str
        return None

    @field_validator("so_dien_thoai", mode="before")
    @classmethod
    def validate_phone_format(cls, v):
        if v is not None:
            v_str = str(v).strip()
            if not v_str:
                return None
            digits = re.sub(r"[^\d]", "", v_str)
            if len(digits) < 7 or len(digits) > 20:
                raise ValueError("Số điện thoại không hợp lệ (phải chứa từ 7 đến 20 chữ số).")
            return v_str
        return None


class RegionCreate(RegionBase):
    """Dữ liệu thêm mới vùng trồng MSVT"""
    geometry: Optional[GeometryInput] = None


class RegionUpdate(RegionBase):
    """Dữ liệu cập nhật toàn bộ (PUT) vùng trồng MSVT"""
    geometry: Optional[GeometryInput] = None


class RegionPatch(BaseModel):
    """
    Dữ liệu cập nhật từng phần (PATCH) vùng trồng MSVT.
    Nếu không gửi trường geometry, giữ nguyên hình học cũ.
    """
    msvt_moi: Optional[str] = None
    msvt_cu: Optional[str] = None
    to_chuc_ca_nhan: Optional[str] = None
    nguoi_dai_dien: Optional[str] = None
    so_dien_thoai: Optional[str] = None
    email: Optional[str] = None
    toa_do_goc: Optional[str] = None
    dia_chi_msvt: Optional[str] = None
    loai_cay_trong: Optional[str] = None
    so_ho_tham_gia: Optional[int] = Field(None, ge=0)
    dien_tich_ha: Optional[float] = Field(None, ge=0.0)
    tong_san_luong_tan: Optional[float] = Field(None, ge=0.0)
    san_luong_tan_ha: Optional[float] = Field(None, ge=0.0)
    quy_trinh: Optional[str] = None
    thi_truong: Optional[str] = None
    geometry: Optional[GeometryInput] = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("msvt_moi", "msvt_cu", mode="before")
    @classmethod
    def validate_patch_msvt_code(cls, v):
        if v is not None:
            v_str = str(v).strip()
            return v_str if v_str else None
        return None

    @field_validator("email", mode="before")
    @classmethod
    def validate_patch_email(cls, v):
        if v is not None:
            v_str = str(v).strip()
            if not v_str:
                return None
            if "@" not in v_str or "." not in v_str:
                raise ValueError("Định dạng email không hợp lệ (cần chứa ký tự @ và tên miền).")
            return v_str
        return None

    @field_validator("so_dien_thoai", mode="before")
    @classmethod
    def validate_patch_phone(cls, v):
        if v is not None:
            v_str = str(v).strip()
            if not v_str:
                return None
            digits = re.sub(r"[^\d]", "", v_str)
            if len(digits) < 7 or len(digits) > 20:
                raise ValueError("Số điện thoại không hợp lệ (phải chứa từ 7 đến 20 chữ số).")
            return v_str
        return None


class AdminRegionDetail(RegionDetail):
    """Schema chi tiết đầy đủ dành riêng cho quản trị viên (Bao gồm SĐT, Email và thông tin Soft Delete)"""
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[int] = None


class AdminPaginatedRegionsResponse(BaseModel):
    """Danh sách vùng trồng phân trang dành cho Quản trị viên"""
    total: int
    page: int
    page_size: int
    total_pages: int
    items: List[AdminRegionDetail]


# ==============================================================================
# SCHEMAS CHO CHỨC NĂNG IMPORT EXCEL VÙNG TRỒNG (MSVT)
# ==============================================================================

class ImportColumnInfo(BaseModel):
    col_index: int
    col_letter: str
    header_text: str
    suggested_field: Optional[str] = None


class ImportUploadResponse(BaseModel):
    job_id: str
    filename: str
    file_size_bytes: int
    sheets: List[str]
    default_sheet: str
    detected_header_row: int
    detected_data_start_row: int
    columns: List[ImportColumnInfo]
    sample_rows: List[List[Optional[str]]]


class ImportValidateRequest(BaseModel):
    sheet_name: str
    header_row: int = 1
    data_start_row: int = 2
    mapping: Dict[str, Optional[int]]
    skip_duplicates: bool = True


class ImportRowItem(BaseModel):
    row_id: int
    excel_row: int
    section: Optional[str] = None
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
    tong_san_luong_tan: Optional[float] = None
    san_luong_tan_ha: Optional[float] = None
    quy_trinh: Optional[str] = None
    thi_truong: Optional[str] = None
    geom_type: Optional[str] = None
    area_gis_ha: Optional[float] = None
    area_diff_pct: Optional[float] = None
    status: str  # VALID, WARNING, DUPLICATE, INVALID
    status_label: str
    duplicate_type: Optional[str] = None  # 'DB', 'FILE', None
    issues: List[str] = []
    warnings: List[str] = []
    selected: bool = True
    geojson: Optional[Dict[str, Any]] = None
    raw_values: Optional[Dict[str, Any]] = None


class ImportSummaryResponse(BaseModel):
    job_id: str
    filename: str
    sheet_name: Optional[str] = None
    status: str
    total_rows: int
    valid_count: int
    warning_count: int
    duplicate_count: int
    duplicate_db_count: int = 0
    duplicate_file_count: int = 0
    error_count: int
    selected_count: int
    total_area_ha: float
    created_at: Optional[datetime] = None


class ImportPreviewResponse(BaseModel):
    job_id: str
    total: int
    page: int
    page_size: int
    total_pages: int
    summary: ImportSummaryResponse
    items: List[ImportRowItem]


class ImportCommitRequest(BaseModel):
    selected_row_ids: Optional[List[int]] = None
    confirm_warnings: bool = True


class ImportCommitResponse(BaseModel):
    job_id: str
    message: str
    total_rows: int = 0
    inserted_count: int
    skipped_count: int
    skipped_db_count: int = 0
    skipped_file_count: int = 0
    error_count: int = 0
    failed_count: int = 0
    inserted_ids: List[int]
    total_area_added_ha: float
    skipped_rows_detail: List[Dict[str, Any]] = []


class ImportJobListItem(BaseModel):
    id: str
    filename: str
    sheet_name: Optional[str] = None
    status: str
    total_rows: int
    valid_count: int
    warning_count: int
    duplicate_count: int
    error_count: int
    imported_count: int
    created_at: datetime
    committed_at: Optional[datetime] = None

