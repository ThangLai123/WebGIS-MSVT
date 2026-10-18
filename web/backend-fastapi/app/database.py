import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Nạp file .env từ thư mục backend-fastapi hoặc thư mục gốc dự án
BASE_DIR = Path(__file__).resolve().parent.parent
LOCAL_ENV = BASE_DIR / ".env"
ROOT_ENV = BASE_DIR.parent / ".env"

if LOCAL_ENV.exists():
    load_dotenv(LOCAL_ENV)
elif ROOT_ENV.exists():
    load_dotenv(ROOT_ENV)

# 1. Đọc chuỗi kết nối DATABASE_URL từ biến môi trường (ưu tiên hàng đầu cho Production / Cloud / Vercel)
raw_database_url = os.getenv("DATABASE_URL")
if raw_database_url and raw_database_url.strip():
    clean_url = raw_database_url.strip()
    # Chuẩn hóa URI cho driver psycopg (v3) tương thích hoàn toàn với SQLAlchemy 2
    # Các nhà cung cấp PostgreSQL đám mây (Neon, Supabase, Railway, Vercel Postgres)
    # thường trả về URI bắt đầu bằng 'postgres://' hoặc 'postgresql://'
    if clean_url.startswith("postgres://"):
        DATABASE_URL = clean_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif clean_url.startswith("postgresql://") and not clean_url.startswith("postgresql+"):
        DATABASE_URL = clean_url.replace("postgresql://", "postgresql+psycopg://", 1)
    else:
        DATABASE_URL = clean_url
else:
    # 2. Cấu hình fallback cho môi trường Windows kết nối Docker container local
    DB_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
    DB_PORT = os.getenv("POSTGRES_PORT", "5433")
    DB_NAME = os.getenv("POSTGRES_DB", "webgis_msvt")
    DB_USER = os.getenv("POSTGRES_USER", "webgis_admin")
    DB_PASS = os.getenv("POSTGRES_PASSWORD", "")
    DATABASE_URL = f"postgresql+psycopg://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Phát hiện môi trường Serverless (Vercel / AWS Lambda)
IS_SERVERLESS = bool(os.getenv("VERCEL")) or bool(os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

# Cấu hình search_path cho mọi phiên kết nối: tự động nhận diện cả schema public và extensions
# Đảm bảo các hàm PostGIS (ST_Covers, ST_IsValid, v.v.) hoạt động trơn tru trên cả Local Docker và Supabase
db_connect_args = {"options": "-csearch_path=public,extensions"}

if IS_SERVERLESS:
    # Trên Vercel Serverless Function, sử dụng NullPool để đóng kết nối ngay sau khi hoàn tất request,
    # tránh làm cạn kiệt connection pool của dịch vụ PostgreSQL Cloud khi có nhiều function instances.
    from sqlalchemy.pool import NullPool
    engine = create_engine(
        DATABASE_URL,
        poolclass=NullPool,
        connect_args=db_connect_args,
        echo=False
    )
else:
    # Môi trường máy chủ thông thường / Local development
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        connect_args=db_connect_args,
        echo=False
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass


def get_db():
    """Dependency cung cấp SQLAlchemy Session cho các route FastAPI"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
