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

# Đọc cấu hình từ biến môi trường (mặc định cho môi trường Windows kết nối Docker)
DB_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
DB_PORT = os.getenv("POSTGRES_PORT", "5433")
DB_NAME = os.getenv("POSTGRES_DB", "webgis_msvt")
DB_USER = os.getenv("POSTGRES_USER", "webgis_admin")
DB_PASS = os.getenv("POSTGRES_PASSWORD", "")

# Sử dụng driver psycopg (v3) tương thích hoàn toàn với SQLAlchemy 2
DATABASE_URL = f"postgresql+psycopg://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Khởi tạo engine với pool_pre_ping để tự động khôi phục kết nối khi container khởi động lại
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=False
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency cung cấp SQLAlchemy Session cho các route FastAPI"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
