from sqlalchemy import Column, BigInteger, Text, Integer, Numeric, DateTime
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

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    msvt_moi = Column(Text, nullable=True, index=True)
    msvt_cu = Column(Text, nullable=True, index=True)
    to_chuc_ca_nhan = Column(Text, nullable=True)
    nguoi_dai_dien = Column(Text, nullable=True)
    so_dien_thoai = Column(Text, nullable=True)
    email = Column(Text, nullable=True)
    toa_do_goc = Column(Text, nullable=True)
    dia_chi_msvt = Column(Text, nullable=True)
    loai_cay_trong = Column(Text, nullable=True)
    so_ho_tham_gia = Column(Integer, nullable=True)
    dien_tich_ha = Column(Numeric(14, 4), nullable=True)
    san_luong_tan_ha = Column(Numeric(14, 4), nullable=True)
    quy_trinh = Column(Text, nullable=True)
    thi_truong = Column(Text, nullable=True)
    vi_tri = Column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    ranh_gioi = Column(Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
    tong_san_luong_tan = Column(Numeric(14, 4), nullable=True)
