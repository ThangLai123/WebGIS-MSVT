from decimal import Decimal
from typing import Optional, Any
from datetime import datetime
from sqlalchemy import BigInteger, Text, Integer, Numeric, DateTime, String, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from geoalchemy2 import Geometry
from .database import Base


class VungTrong(Base):
    """
    SQLAlchemy Model ánh xạ khớp 100% với cấu trúc 20 cột của bảng public.vung_trong.
    Không tự động tạo lại bảng (Quản lý schema qua các SQL migration).
    """
    __tablename__ = "vung_trong"
    __table_args__ = {"schema": "public"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True, autoincrement=True)
    msvt_moi: Mapped[Optional[str]] = mapped_column(Text, nullable=True, index=True)
    msvt_cu: Mapped[Optional[str]] = mapped_column(Text, nullable=True, index=True)
    to_chuc_ca_nhan: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    nguoi_dai_dien: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    so_dien_thoai: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    toa_do_goc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dia_chi_msvt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    loai_cay_trong: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    so_ho_tham_gia: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    dien_tich_ha: Mapped[Optional[Decimal | float]] = mapped_column(Numeric(14, 4), nullable=True)
    san_luong_tan_ha: Mapped[Optional[Decimal | float]] = mapped_column(Numeric(14, 4), nullable=True)
    quy_trinh: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    thi_truong: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vi_tri: Mapped[Optional[Any]] = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    ranh_gioi: Mapped[Optional[Any]] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
    tong_san_luong_tan: Mapped[Optional[Decimal | float]] = mapped_column(Numeric(14, 4), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false", index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("public.admin_users.id"), nullable=True)


from sqlalchemy.dialects.postgresql import JSONB

class AdminUser(Base):
    """
    SQLAlchemy Model ánh xạ tới bảng public.admin_users.
    Phục vụ xác thực, phân quyền và chống tấn công Brute-force.
    """
    __tablename__ = "admin_users"
    __table_args__ = {"schema": "public"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer", server_default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    failed_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class MsvtImportJob(Base):
    """
    SQLAlchemy Model ánh xạ bảng public.msvt_import_jobs.
    Lưu vết phiên nhập dữ liệu Excel, cấu hình ánh xạ, kết quả DRY RUN và kết quả commit.
    """
    __tablename__ = "msvt_import_jobs"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("public.admin_users.id"), nullable=True)
    sheet_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    header_row: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    data_start_row: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    mapping_config: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    valid_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="uploaded")
    validated_rows: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    import_result: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    temp_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    committed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

