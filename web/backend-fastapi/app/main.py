import logging
from fastapi import FastAPI, Depends, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from .database import get_db, engine
from .config import CORS_ORIGINS
from .routers import regions, auth, imports

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("webgis_msvt_api")

app = FastAPI(
    title="WebGIS MSVT API",
    description="Hệ thống Backend FastAPI quản lý Mã số Vùng trồng (MSVT) - Tỉnh Nghệ An",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Cấu hình CORS: Cho phép các domain Frontend chỉ định, hỗ trợ credentials cookie, không dùng wildcard
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
    Áp dụng quy trình chẩn đoán đa tầng chỉ đọc (Read-only diagnostics):
    - Tầng 1: Kiểm tra kết nối cơ sở (SELECT 1, current_database, current_user).
    - Tầng 2: Kiểm tra cài đặt và schema của PostGIS trong pg_extension.
    - Tầng 3: Kiểm tra sự tồn tại của bảng public.vung_trong và đếm số bản ghi.
    """
    from .database import IS_DATABASE_URL_CONFIGURED, IS_SERVERLESS

    # Kiểm tra biến môi trường DATABASE_URL trên môi trường Serverless
    if IS_SERVERLESS and not IS_DATABASE_URL_CONFIGURED:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unhealthy",
                "database": {"connected": False},
                "diagnostics": {
                    "stage": "configuration",
                    "code": "MISSING_DATABASE_URL",
                    "message": "Biến môi trường DATABASE_URL chưa được cấu hình trên Vercel."
                },
                "api_version": "1.0.0"
            }
        )

    diag_data = {
        "connected": False,
        "database_name": None,
        "search_path": None,
        "postgis": {
            "installed": False,
            "version": None,
            "schema": None,
            "function_callable": False
        },
        "vung_trong": {
            "exists": False,
            "count": None
        }
    }

    # BƯỚC 1: Kiểm tra kết nối cơ sở (SELECT 1, current_database)
    try:
        row = db.execute(text("SELECT 1, current_database();")).fetchone()
        if row:
            diag_data["connected"] = True
            diag_data["database_name"] = str(row[1]) if len(row) > 1 and row[1] else None
    except Exception as e:
        err_str = str(e).lower()
        code = "CONNECTION_FAILED"
        msg = "Không thể kết nối đến máy chủ PostgreSQL."

        if "timeout" in err_str or "timed out" in err_str:
            code = "DNS_OR_TIMEOUT"
            msg = "Hết thời gian chờ kết nối (Connection Timeout / DNS). Kiểm tra địa chỉ host pooler và mạng."
        elif "password" in err_str or "authentication" in err_str or "tenant" in err_str:
            code = "AUTH_FAILED"
            msg = "Xác thực thất bại. Kiểm tra mật khẩu hoặc định dạng username (Ví dụ Supabase Session pooler cần: postgres.<project-ref>)."
        elif "refused" in err_str or "unreachable" in err_str or "no route" in err_str:
            code = "NETWORK_UNREACHABLE"
            msg = "Mạng không thể tiếp cận máy chủ (Network unreachable / IPv6). Hãy sử dụng Supabase Pooler qua IPv4."

        logger.error(f"[Health Check] Lỗi kết nối DB: {e}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unhealthy",
                "database": {"connected": False},
                "diagnostics": {
                    "stage": "connectivity",
                    "code": code,
                    "message": msg
                },
                "api_version": "1.0.0"
            }
        )

    # BƯỚC 2: Kiểm tra search_path phiên làm việc hiện tại
    try:
        sp_row = db.execute(text("SHOW search_path;")).fetchone()
        diag_data["search_path"] = str(sp_row[0]) if sp_row else None
    except Exception:
        pass

    # BƯỚC 3: Kiểm tra extension PostGIS trong pg_extension
    postgis_code = "OK"
    postgis_msg = "Extension PostGIS sẵn sàng."
    try:
        ext_row = db.execute(text(
            "SELECT extname, extversion, extnamespace::regnamespace::text "
            "FROM pg_extension WHERE extname = 'postgis';"
        )).fetchone()
        if ext_row:
            diag_data["postgis"]["installed"] = True
            diag_data["postgis"]["version"] = str(ext_row[1])
            diag_data["postgis"]["schema"] = str(ext_row[2])
        else:
            diag_data["postgis"]["installed"] = False
            postgis_code = "POSTGIS_NOT_INSTALLED"
            postgis_msg = "Extension PostGIS chưa được kích hoạt trong database."
    except Exception as e:
        logger.warning(f"[Health Check] Không thể truy vấn pg_extension: {e}")
        postgis_code = "POSTGIS_CHECK_ERROR"
        postgis_msg = "Lỗi khi kiểm tra extension PostGIS trong pg_extension."

    # Kiểm tra khả năng gọi hàm PostGIS_Version()
    if diag_data["postgis"]["installed"]:
        try:
            ver_row = db.execute(text("SELECT PostGIS_Version();")).fetchone()
            if ver_row:
                diag_data["postgis"]["function_callable"] = True
                diag_data["postgis"]["version"] = str(ver_row[0])
        except Exception as e:
            logger.warning(f"[Health Check] Gọi PostGIS_Version() trực tiếp thất bại, thử schema extensions: {e}")
            try:
                ver_ext = db.execute(text("SELECT extensions.PostGIS_Version();")).fetchone()
                if ver_ext:
                    diag_data["postgis"]["function_callable"] = True
                    diag_data["postgis"]["version"] = str(ver_ext[0])
                    postgis_code = "POSTGIS_SEARCH_PATH_WARNING"
                    postgis_msg = "PostGIS nằm trong schema extensions nhưng search_path chưa bao gồm extensions."
            except Exception:
                diag_data["postgis"]["function_callable"] = False
                postgis_code = "POSTGIS_FUNCTION_FAILED"
                postgis_msg = "Không thể thực thi hàm PostGIS_Version()."

    # BƯỚC 4: Kiểm tra sự tồn tại của bảng public.vung_trong
    table_code = "OK"
    table_msg = "Bảng dữ liệu sẵn sàng."
    try:
        tbl_row = db.execute(text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'vung_trong';"
        )).fetchone()
        diag_data["vung_trong"]["exists"] = bool(tbl_row)
        if not tbl_row:
            table_code = "TABLE_VUNG_TRONG_NOT_FOUND"
            table_msg = "Bảng public.vung_trong chưa tồn tại (Cần chạy file migration schema)."
    except Exception as e:
        logger.warning(f"[Health Check] Kiểm tra bảng vung_trong thất bại: {e}")
        table_code = "TABLE_INSPECT_ERROR"
        table_msg = "Lỗi khi kiểm tra information_schema cho bảng public.vung_trong."

    # BƯỚC 5: Đếm số lượng bản ghi trong public.vung_trong (nếu bảng tồn tại)
    if diag_data["vung_trong"]["exists"]:
        try:
            cnt_row = db.execute(text("SELECT COUNT(*) FROM public.vung_trong;")).fetchone()
            diag_data["vung_trong"]["count"] = cnt_row[0] if cnt_row else 0
        except Exception as e:
            err_str = str(e).lower()
            logger.warning(f"[Health Check] Đếm số lượng vung_trong thất bại: {e}")
            if "permission" in err_str or "denied" in err_str:
                table_code = "PERMISSION_DENIED"
                table_msg = "Quyền truy cập bị từ chối trên bảng public.vung_trong (Kiểm tra phân quyền role/RLS)."
            else:
                table_code = "SQL_QUERY_ERROR"
                table_msg = "Lỗi khi thực thi câu truy vấn SQL trên bảng public.vung_trong."

    # Đánh giá trạng thái tổng thể
    is_healthy = (
        diag_data["connected"]
        and diag_data["postgis"]["installed"]
        and diag_data["postgis"]["function_callable"]
        and diag_data["vung_trong"]["exists"]
        and table_code == "OK"
        and postgis_code == "OK"
    )

    final_status = "healthy" if is_healthy else "degraded"
    final_code = "OK" if is_healthy else (table_code if table_code != "OK" else postgis_code)
    final_msg = "Tất cả dịch vụ cơ sở dữ liệu và PostGIS hoạt động tốt." if is_healthy else f"{postgis_msg} {table_msg}".strip()

    return {
        "status": final_status,
        "database": diag_data,
        "diagnostics": {
            "code": final_code,
            "message": final_msg
        },
        "api_version": "1.0.0"
    }


# Đăng ký các router nghiệp vụ
app.include_router(regions.router)
app.include_router(auth.router)
app.include_router(imports.router)



@app.get("/", summary="Điểm kiểm tra trang chủ API")
def root():
    return {
        "message": "Chào mừng đến với Hệ thống WebGIS Quản lý Mã số Vùng trồng (MSVT) API",
        "docs": "/docs",
        "redoc": "/redoc",
        "openapi": "/openapi.json",
        "health": "/health",
        "auth_api": "/api/auth",
        "regions_api": "/api/regions",
        "geojson_api": "/api/regions/geojson"
    }


@app.get("/api", summary="Điểm kiểm tra danh mục API")
def api_root():
    return {
        "message": "WebGIS MSVT API Gateway",
        "docs": "/docs",
        "endpoints": {
            "geojson": "/api/regions/geojson",
            "regions": "/api/regions",
            "statistics": "/api/statistics",
            "lookup": "/api/regions/lookup",
            "auth": "/api/auth/login"
        }
    }


@app.get("/api/index.py", include_in_schema=False)
@app.get("/api/index", include_in_schema=False)
def legacy_index_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/", status_code=status.HTTP_308_PERMANENT_REDIRECT)

