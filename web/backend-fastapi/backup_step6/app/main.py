import logging
from fastapi import FastAPI, Depends, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from .database import get_db, engine
from .routers import regions

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("webgis_msvt_api")

app = FastAPI(
    title="WebGIS MSVT API",
    description="Hệ thống Backend FastAPI quản lý Mã số Vùng trồng (MSVT) - Tỉnh Nghệ An",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Cấu hình CORS: Chỉ cho phép các domain Frontend chỉ định, không dùng wildcard khi có credentials
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Bắt lỗi toàn cục an toàn, không làm lộ mật khẩu database hay trace nội bộ cho client"""
    logger.error(f"Lỗi máy chủ nội bộ tại {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Đã xảy ra lỗi máy chủ nội bộ. Vui lòng thử lại sau hoặc liên hệ quản trị viên."}
    )


@app.get("/health", summary="Kiểm tra trạng thái hoạt động của FastAPI và PostgreSQL/PostGIS")
def health_check(db: Session = Depends(get_db)):
    """
    Kiểm tra tình trạng sống của API server và kết nối tới database PostGIS.
    """
    try:
        # Kiểm tra kết nối SQL và lấy phiên bản PostGIS
        version_row = db.execute(text("SELECT PostGIS_Version();")).fetchone()
        postgis_ver = version_row[0] if version_row else "Unknown"

        # Kiểm tra số lượng bản ghi trong bảng public.vung_trong
        count_row = db.execute(text("SELECT COUNT(*) FROM public.vung_trong;")).fetchone()
        region_count = count_row[0] if count_row else 0

        return {
            "status": "healthy",
            "database": "connected",
            "postgis_version": postgis_ver,
            "vung_trong_count": region_count,
            "api_version": "1.0.0"
        }
    except Exception as e:
        logger.error(f"Lỗi kiểm tra sức khỏe database: {e}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unhealthy",
                "database": "disconnected",
                "error": "Không thể kết nối đến cơ sở dữ liệu PostgreSQL"
            }
        )


# Đăng ký các router nghiệp vụ
app.include_router(regions.router)


@app.get("/", summary="Điểm kiểm tra trang chủ API")
def root():
    return {
        "message": "Chào mừng đến với Hệ thống WebGIS Quản lý Mã số Vùng trồng (MSVT) API",
        "docs": "/docs",
        "health": "/health",
        "regions_api": "/api/regions",
        "geojson_api": "/api/regions/geojson"
    }
