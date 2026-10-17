"""
Router quản lý quy trình Nhập nhanh dữ liệu MSVT từ Excel vào PostgreSQL/PostGIS.
Chỉ dành riêng cho Quản trị viên (Admin), yêu cầu xác thực Cookie HttpOnly + CSRF.
Tuân thủ nghiêm ngặt nguyên tắc:
1. Không tự động INSERT/UPDATE khi upload.
2. Quy trình DRY RUN bắt buộc để kiểm tra, chuẩn hóa và đối chiếu dữ liệu.
3. Chống trùng lặp MSVT với database và trong cùng file (mặc định BỎ QUA bản ghi trùng).
4. Chuẩn hóa tọa độ GPS Decimal/DMS sang WGS84 (EPSG:4326) qua module coord_parser.
5. Kiểm tra ranh giới Polygon, tự giao cắt và đối chiếu diện tích GIS với diện tích hồ sơ.
6. Xác nhận từ Admin trước khi commit vào PostgreSQL qua Transaction nguyên tử (Atomic).
7. Xuất báo cáo kiểm định 6 sheet bằng openpyxl, chống Excel Formula Injection.
8. Tuyệt đối không thay đổi, sửa đổi hay xóa 51 bản ghi MSVT hiện có.
"""

import re
import io
import json
import uuid
import hashlib
import logging
import os
import tempfile
from typing import Optional, List, Dict, Any
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from ..database import get_db
from ..models import AdminUser, MsvtImportJob
from ..dependencies import require_admin, require_csrf
from ..schemas import (
    ImportUploadResponse,
    ImportColumnInfo,
    ImportValidateRequest,
    ImportRowItem,
    ImportSummaryResponse,
    ImportPreviewResponse,
    ImportCommitRequest,
    ImportCommitResponse,
    ImportJobListItem,
)
from ..coord_parser import parse_and_validate_coordinates

logger = logging.getLogger("webgis_msvt_imports")

router = APIRouter(
    prefix="/api/admin/imports",
    tags=["Admin Imports - Nhập nhanh dữ liệu MSVT từ Excel"],
    dependencies=[Depends(require_admin)]
)

# Thư mục lưu trữ tạm an toàn cho các file Excel upload
# Trên Vercel / AWS Lambda, hệ thống tệp chỉ cho phép ghi tại /tmp (hoặc tempfile.gettempdir())
if os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    TEMP_DIR = Path(tempfile.gettempdir()) / "webgis_temp_imports"
else:
    TEMP_DIR = Path(__file__).resolve().parent.parent.parent / "temp_imports"

try:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
except Exception as _e:
    # Dự phòng an toàn nếu không có quyền ghi tại thư mục ứng dụng
    TEMP_DIR = Path(tempfile.gettempdir()) / "webgis_temp_imports"
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # Giới hạn 10 MB
MAX_DATA_ROWS = 5000               # Giới hạn 5000 dòng

# Định nghĩa các từ khóa nhận diện cột tự động (Alias Mapping)
FIELD_ALIASES = {
    "msvt_moi": [
        "mã số vùng trồng mới", "msvt mới", "mã số mới", "mã mới", "msvt_moi",
        "mã vùng trồng mới", "mã số do nước nhập khẩu cấp", "mã cấp mới"
    ],
    "msvt_cu": [
        "mã số vùng trồng cũ", "msvt cũ", "mã số cũ", "mã cũ", "msvt_cu",
        "mã vùng trồng xuất khẩu", "mã xuất khẩu", "mã cũ đã cấp"
    ],
    "to_chuc_ca_nhan": [
        "tổ chức/cá nhân", "tổ chức cá nhân", "tổ chức, cá nhân", "tên tổ chức",
        "tên cơ sở", "chủ sở hữu", "đơn vị", "hợp tác xã", "htx", "doanh nghiệp",
        "đại diện msvt - tổ chức/cá nhân"
    ],
    "nguoi_dai_dien": [
        "người đại diện", "đại diện", "họ và tên người đại diện", "đại diện pháp luật",
        "đại diện msvt - người đại diện", "nguoi_dai_dien"
    ],
    "so_dien_thoai": [
        "số điện thoại", "sđt", "điện thoại", "tel", "phone", "đại diện msvt - số điện thoại",
        "so_dien_thoai"
    ],
    "email": [
        "địa chỉ hòm thư điện tử", "hòm thư điện tử", "email", "thư điện tử", "mail",
        "đại diện msvt - địa chỉ hòm thư điện tử"
    ],
    "toa_do_goc": [
        "tọa độ địa lý", "tọa độ", "tọa độ gốc", "gps", "vùng trồng - tọa độ địa lý",
        "toa_do_goc", "tọa độ gps"
    ],
    "dia_chi_msvt": [
        "địa chỉ msvt", "địa chỉ vùng trồng", "địa chỉ", "địa điểm", "vùng trồng - địa chỉ msvt",
        "dia_chi_msvt"
    ],
    "loai_cay_trong": [
        "loại cây trồng", "cây trồng", "loại cây", "vùng trồng - loại cây trồng", "loai_cay_trong"
    ],
    "so_ho_tham_gia": [
        "số hộ tham gia", "số hộ", "hộ tham gia", "vùng trồng - số hộ tham gia", "so_ho_tham_gia"
    ],
    "dien_tich_ha": [
        "diện tích (ha)", "diện tích", "quy mô (ha)", "quy mô", "vùng trồng - diện tích (ha)",
        "dien_tich_ha"
    ],
    "tong_san_luong_tan": [
        "tổng sản lượng (tấn)", "tổng sản lượng", "sản lượng (tấn)", "sản lượng",
        "tong_san_luong_tan", "tong san luong"
    ],
    "san_luong_tan_ha": [
        "năng suất (tấn/ha)", "năng suất", "sản lượng (dự kiến tấn/ha)", "tấn/ha",
        "san_luong_tan_ha", "vùng trồng - sản lượng (dự kiến tấn/ha)"
    ],
    "quy_trinh": [
        "quy trình", "quy trình canh tác", "tiêu chuẩn", "vùng trồng - quy trình", "quy_trinh"
    ],
    "thi_truong": [
        "thị trường", "thị trường xuất khẩu", "thi_truong", "thị trường tiêu thụ"
    ]
}


def clean_text(val: Any) -> Optional[str]:
    """Làm sạch chuỗi ký tự, chuẩn hóa khoảng trắng Unicode"""
    if val is None:
        return None
    s = str(val).replace("\xa0", " ").strip()
    return s if s else None


def normalize_phone(val: Any) -> Optional[str]:
    """Chuẩn hóa số điện thoại, bảo toàn số 0 ở đầu nếu Excel tự ép sang số nguyên"""
    if val is None:
        return None
    s = str(val).replace("\xa0", " ").strip()
    if not s:
        return None
    # Nếu chỉ có chữ số và độ dài 9 số (ví dụ 912345678), bù số 0 đầu
    digits = re.sub(r"\D", "", s)
    if len(digits) == 9 and not s.startswith("0"):
        return f"0{s}"
    return s


def sanitize_formula_injection(val: Any) -> Any:
    """Chống Excel Formula Injection: nếu chuỗi bắt đầu bằng =, +, -, @ thì thêm nháy đơn '"""
    if isinstance(val, str) and val and val[0] in ("=", "+", "-", "@"):
        return f"'{val}"
    return val


def get_cell_unmerged(ws, merged_map: Dict[tuple, Any], row: int, col: int) -> Optional[str]:
    """Lấy giá trị ô Excel, xử lý thông minh ô gộp merged cells"""
    val = ws.cell(row, col).value
    if val is not None and str(val).strip():
        return str(val).strip()
    merged_val = merged_map.get((row, col))
    if merged_val is not None and str(merged_val).strip():
        return str(merged_val).strip()
    return None


def inspect_sheet_structure(ws) -> Dict[str, Any]:
    """
    Phân tích cấu trúc sheet:
    - Giải nén merged cells
    - Phát hiện tiêu đề 1 tầng hoặc 2 tầng (multi-level headers)
    - Tự động nhận diện dòng tiêu đề tốt nhất và dòng bắt đầu dữ liệu
    - Gợi ý ánh xạ cột sang các trường PostgreSQL
    """
    merged_map = {}
    for mrange in ws.merged_cells.ranges:
        top_left_val = ws.cell(mrange.min_row, mrange.min_col).value
        for r in range(mrange.min_row, mrange.max_row + 1):
            for c in range(mrange.min_col, mrange.max_col + 1):
                merged_map[(r, c)] = top_left_val

    max_col = min(ws.max_column or 1, 50)
    max_scan_row = min(ws.max_row or 1, 15)

    # 1. Tìm dòng tiêu đề ứng viên (từ dòng 1 đến 10)
    best_header_row = 1
    best_sub_header_row = None
    max_keyword_matches = -1

    all_keywords = []
    for k_list in FIELD_ALIASES.values():
        all_keywords.extend(k_list)

    for r in range(1, max_scan_row + 1):
        row_texts = [get_cell_unmerged(ws, merged_map, r, c) or "" for c in range(1, max_col + 1)]
        non_empty = [t for t in row_texts if t]
        if not non_empty:
            continue

        match_count = 0
        for text_val in non_empty:
            lower = text_val.lower()
            if any(kw in lower for kw in all_keywords) or "stt" in lower:
                match_count += 1

        if match_count > max_keyword_matches:
            max_keyword_matches = match_count
            best_header_row = r

    # Kiểm tra xem có dòng sub-header liền kề (Multi-level header) không (ví dụ dòng 4 và 5)
    if best_header_row > 1:
        prev_r = best_header_row - 1
        prev_texts = [get_cell_unmerged(ws, merged_map, prev_r, c) or "" for c in range(1, max_col + 1)]
        prev_matches = sum(1 for t in prev_texts if any(kw in t.lower() for kw in all_keywords) or "đại diện" in t.lower() or "vùng trồng" in t.lower())
        if prev_matches >= 2:
            best_sub_header_row = best_header_row
            best_header_row = prev_r

    # Xây dựng danh sách tên cột tổng hợp
    columns_info: List[Dict[str, Any]] = []
    for c in range(1, max_col + 1):
        col_letter = get_column_letter(c)
        if best_sub_header_row:
            top_h = get_cell_unmerged(ws, merged_map, best_header_row, c) or ""
            sub_h = get_cell_unmerged(ws, merged_map, best_sub_header_row, c) or ""
            if top_h and sub_h and top_h != sub_h:
                header_text = f"{top_h} - {sub_h}"
            else:
                header_text = sub_h or top_h
        else:
            header_text = get_cell_unmerged(ws, merged_map, best_header_row, c) or ""

        # Gợi ý ánh xạ trường database
        suggested_field = None
        lower_h = header_text.lower().strip()
        if lower_h:
            # Ưu tiên năng suất nếu có tấn/ha
            if "tấn/ha" in lower_h or "tan/ha" in lower_h:
                suggested_field = "san_luong_tan_ha"
            else:
                for field_name, aliases in FIELD_ALIASES.items():
                    if any(alias in lower_h for alias in aliases):
                        suggested_field = field_name
                        break

        columns_info.append({
            "col_index": c,
            "col_letter": col_letter,
            "header_text": header_text.strip() or f"Cột {col_letter}",
            "suggested_field": suggested_field
        })

    # Tìm dòng bắt đầu dữ liệu (dòng đầu tiên sau header có số STT hoặc mã MSVT hoặc dữ liệu hợp lệ)
    start_search_row = (best_sub_header_row or best_header_row) + 1
    detected_data_start_row = start_search_row
    for r in range(start_search_row, min(ws.max_row or 1, start_search_row + 10)):
        c1 = get_cell_unmerged(ws, merged_map, r, 1) or ""
        c2 = get_cell_unmerged(ws, merged_map, r, 2) or ""
        # Bỏ qua nếu là dòng section "I. MÃ SỐ VÙNG TRỒNG NỘI ĐỊA"
        if c1 in ("I", "II", "III") or "MÃ SỐ VÙNG TRỒNG" in c2.upper() or "MÃ SỐ VÙNG TRỒNG" in c1.upper():
            continue
        # Nếu có STT dạng số hoặc có mã MSVT
        if c1.isdigit() or re.search(r"\d", c2):
            detected_data_start_row = r
            break

    # Lấy mẫu dữ liệu 5 dòng
    sample_rows = []
    curr_r = detected_data_start_row
    collected = 0
    while curr_r <= (ws.max_row or 1) and collected < 5:
        row_vals = [get_cell_unmerged(ws, merged_map, curr_r, c) for c in range(1, max_col + 1)]
        if any(row_vals):
            sample_rows.append(row_vals)
            collected += 1
        curr_r += 1

    return {
        "header_row": best_sub_header_row or best_header_row,
        "data_start_row": detected_data_start_row,
        "columns": columns_info,
        "sample_rows": sample_rows,
        "merged_map": merged_map
    }


# ==============================================================================
# ENDPOINT 1: TẢI FILE EXCEL LÊN VÀ PHÂN TÍCH CẤU TRÚC
# ==============================================================================
@router.post("/upload", response_model=ImportUploadResponse, summary="Upload file Excel và phân tích cấu trúc ban đầu")
async def upload_excel_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: AdminUser = Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db)
):
    """
    Nhận file Excel (.xlsx, .xlsm), kiểm tra định dạng và kích thước an toàn.
    Lưu trữ tạm và phân tích các sheet, tiêu đề, gợi ý ánh xạ cột.
    Tuyệt đối không ghi dữ liệu vào bảng public.vung_trong.
    """
    filename = file.filename or "import.xlsx"
    ext = Path(filename).suffix.lower()

    if ext not in (".xlsx", ".xlsm"):
        if ext == ".xls":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Định dạng file .xls (Excel 97-2003) không được hỗ trợ trực tiếp. Vui lòng mở bằng Excel và lưu lại thành .xlsx."
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Định dạng tệp '{ext}' không hợp lệ. Hệ thống chỉ hỗ trợ tệp Excel chuẩn (.xlsx)."
        )

    # Đọc nội dung file với giới hạn kích thước an toàn
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Dung lượng tệp vượt quá giới hạn cho phép (Tối đa {MAX_FILE_SIZE // (1024*1024)} MB)."
        )

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tệp Excel tải lên rỗng (0 bytes). Vui lòng chọn tệp có chứa dữ liệu."
        )

    # Tính toán SHA256 file hash để kiểm tra tính toàn vẹn
    file_hash = hashlib.sha256(content).hexdigest()
    job_id = f"imp_{uuid.uuid4().hex[:12]}"
    temp_file_name = f"{job_id}_{file_hash[:8]}.xlsx"
    temp_path = TEMP_DIR / temp_file_name

    with open(temp_path, "wb") as f:
        f.write(content)

    # Đọc cấu trúc file Excel bằng openpyxl an toàn
    try:
        wb = openpyxl.load_workbook(temp_path, data_only=True)
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        logger.error(f"Lỗi mở file Excel: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Không thể đọc tệp Excel. Tệp có thể bị hỏng hoặc được bảo vệ bằng mật khẩu. Chi tiết: {str(e)}"
        )

    sheet_names = wb.sheetnames
    if not sheet_names:
        if temp_path.exists():
            temp_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tệp Excel không chứa bất kỳ Sheet nào."
        )

    default_sheet = sheet_names[0]
    ws = wb[default_sheet]

    # Phân tích cấu trúc sheet mặc định
    structure = inspect_sheet_structure(ws)

    # Lưu thông tin phiên import vào bảng public.msvt_import_jobs
    import_job = MsvtImportJob(
        id=job_id,
        filename=filename,
        file_hash=file_hash,
        uploaded_by=current_user.id,
        sheet_name=default_sheet,
        header_row=structure["header_row"],
        data_start_row=structure["data_start_row"],
        mapping_config={c["suggested_field"]: c["col_index"] for c in structure["columns"] if c["suggested_field"]},
        status="uploaded",
        temp_file_path=str(temp_path),
        total_rows=0,
        valid_count=0,
        warning_count=0,
        duplicate_count=0,
        error_count=0,
        imported_count=0
    )
    db.add(import_job)
    db.commit()

    return ImportUploadResponse(
        job_id=job_id,
        filename=filename,
        file_size_bytes=file_size,
        sheets=sheet_names,
        default_sheet=default_sheet,
        detected_header_row=structure["header_row"],
        detected_data_start_row=structure["data_start_row"],
        columns=[ImportColumnInfo(**c) for c in structure["columns"]],
        sample_rows=structure["sample_rows"]
    )


# ==============================================================================
# ENDPOINT 2: CHẠY DRY RUN KIỂM ĐỊNH TOÀN DIỆN DỮ LIỆU
# ==============================================================================
@router.post("/{job_id}/validate", response_model=ImportSummaryResponse, summary="Chạy DRY RUN kiểm định toàn diện dữ liệu")
async def validate_import_job(
    job_id: str,
    payload: ImportValidateRequest,
    current_user: AdminUser = Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db)
):
    """
    Thực hiện DRY RUN kiểm tra toàn diện dữ liệu:
    - KHÔNG INSERT, KHÔNG UPDATE, KHÔNG THAY ĐỔI DATABASE.
    - Chuẩn hóa kiểu dữ liệu, chuỗi, số điện thoại, diện tích, sản lượng.
    - Đối chiếu trùng MSVT mới và cũ với cơ sở dữ liệu hiện có và trong cùng file.
    - Chuẩn hóa tọa độ GPS Decimal/DMS, kiểm tra hình học và đối chiếu diện tích GIS.
    - Phân loại rõ từng dòng: HỢP LỆ (VALID), CẢNH BÁO (WARNING), TRÙNG (DUPLICATE), LỖI (INVALID).
    """
    job = db.query(MsvtImportJob).filter(MsvtImportJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên nhập dữ liệu.")

    if not job.temp_file_path or not Path(job.temp_file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tệp Excel tạm thời của phiên này đã hết hạn hoặc bị xóa. Vui lòng tải lại tệp."
        )

    temp_path = Path(job.temp_file_path)
    try:
        wb = openpyxl.load_workbook(temp_path, data_only=True)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Lỗi mở file Excel: {str(e)}")

    if payload.sheet_name not in wb.sheetnames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Sheet '{payload.sheet_name}' không tồn tại trong tệp Excel."
        )

    ws = wb[payload.sheet_name]

    # Giải nén merged cells
    merged_map = {}
    for mrange in ws.merged_cells.ranges:
        top_left_val = ws.cell(mrange.min_row, mrange.min_col).value
        for r in range(mrange.min_row, mrange.max_row + 1):
            for c in range(mrange.min_col, mrange.max_col + 1):
                merged_map[(r, c)] = top_left_val

    # Lấy toàn bộ MSVT hiện hữu trong database để kiểm tra trùng
    db_records = db.execute(
        text("SELECT id, msvt_moi, msvt_cu, is_deleted, dia_chi_msvt FROM public.vung_trong")
    ).fetchall()

    db_active_moi: Dict[str, int] = {}
    db_active_cu: Dict[str, int] = {}
    db_deleted_moi: Dict[str, int] = {}
    db_deleted_cu: Dict[str, int] = {}

    for row in db_records:
        r_id, r_moi, r_cu, r_deleted, _ = row
        if r_moi:
            norm_m = r_moi.strip()
            if r_deleted:
                db_deleted_moi[norm_m] = r_id
            else:
                db_active_moi[norm_m] = r_id
        if r_cu:
            norm_c = r_cu.strip()
            if r_deleted:
                db_deleted_cu[norm_c] = r_id
            else:
                db_active_cu[norm_c] = r_id

    # Theo dõi trùng trong cùng file Excel
    file_seen_moi: Dict[str, int] = {}
    file_seen_cu: Dict[str, int] = {}

    validated_rows: List[Dict[str, Any]] = []
    mapping = payload.mapping

    data_start = max(payload.data_start_row, 1)
    max_row = min(ws.max_row or 1, data_start + MAX_DATA_ROWS)

    current_section = "Nội địa"
    row_counter = 0

    for r in range(data_start, max_row + 1):
        # Trích xuất giá trị các ô theo dòng
        raw_row_vals = {}
        for field, col_idx in mapping.items():
            if col_idx is not None and col_idx > 0:
                raw_row_vals[field] = get_cell_unmerged(ws, merged_map, r, col_idx)
            else:
                raw_row_vals[field] = None

        # Kiểm tra nếu là dòng phân nhóm Section
        val_msvt_moi = clean_text(raw_row_vals.get("msvt_moi"))
        val_msvt_cu = clean_text(raw_row_vals.get("msvt_cu"))
        val_to_chuc = clean_text(raw_row_vals.get("to_chuc_ca_nhan"))
        val_toa_do = raw_row_vals.get("toa_do_goc")

        # Kiểm tra xem dòng có phải là dòng tiêu đề nhóm hoặc dòng trống
        first_cell = get_cell_unmerged(ws, merged_map, r, 1) or ""
        second_cell = get_cell_unmerged(ws, merged_map, r, 2) or ""

        if "XUẤT KHẨU" in second_cell.upper() or "XUẤT KHẨU" in first_cell.upper():
            current_section = "Xuất khẩu"
            continue
        if "NỘI ĐỊA" in second_cell.upper() or "NỘI ĐỊA" in first_cell.upper():
            current_section = "Nội địa"
            continue
        if first_cell in ("I", "II", "III") or "MÃ SỐ VÙNG TRỒNG" in second_cell.upper() or "MÃ SỐ VÙNG TRỒNG" in first_cell.upper():
            continue
        if first_cell == "STT" or "nước nhập khẩu" in second_cell.lower():
            continue

        # Nếu toàn bộ dòng trống -> bỏ qua
        if not any(v is not None and str(v).strip() for v in raw_row_vals.values()):
            continue

        # Nếu dòng không có bất kỳ mã MSVT, không có tên tổ chức và không có tọa độ -> dòng chú thích hoặc dòng rác
        if not val_msvt_moi and not val_msvt_cu and not val_to_chuc and not val_toa_do:
            continue

        row_counter += 1
        issues: List[str] = []
        warnings: List[str] = []
        is_duplicate = False

        # 1. Kiểm tra mã định danh MSVT
        if not val_msvt_moi and not val_msvt_cu:
            issues.append("Thiếu cả mã MSVT mới và MSVT cũ (không có thông tin định danh vùng trồng).")
        elif not val_msvt_moi and val_msvt_cu:
            warnings.append(f"Chưa có mã MSVT mới, sử dụng mã MSVT cũ '{val_msvt_cu}' để định danh.")
        elif val_msvt_moi and not val_msvt_cu:
            warnings.append(f"Có mã MSVT mới '{val_msvt_moi}' nhưng chưa có mã MSVT cũ.")

        # 2. Kiểm tra trùng mã trong cùng file Excel
        if val_msvt_moi:
            if val_msvt_moi in file_seen_moi:
                is_duplicate = True
                issues.append(f"Mã MSVT mới '{val_msvt_moi}' bị trùng lặp với dòng {file_seen_moi[val_msvt_moi]} trong cùng file Excel.")
            else:
                file_seen_moi[val_msvt_moi] = r

        if val_msvt_cu:
            if val_msvt_cu in file_seen_cu:
                is_duplicate = True
                issues.append(f"Mã MSVT cũ '{val_msvt_cu}' bị trùng lặp với dòng {file_seen_cu[val_msvt_cu]} trong cùng file Excel.")
            else:
                file_seen_cu[val_msvt_cu] = r

        # 3. Kiểm tra trùng mã với database hiện hữu
        if val_msvt_moi:
            if val_msvt_moi in db_active_moi:
                is_duplicate = True
                issues.append(f"Mã MSVT mới '{val_msvt_moi}' đã tồn tại trong database (Bản ghi ID: {db_active_moi[val_msvt_moi]}).")
            elif val_msvt_moi in db_deleted_moi:
                is_duplicate = True
                issues.append(f"Mã MSVT mới '{val_msvt_moi}' trùng với vùng trồng đã xóa mềm (ID: {db_deleted_moi[val_msvt_moi]}).")

        if val_msvt_cu:
            if val_msvt_cu in db_active_cu:
                is_duplicate = True
                issues.append(f"Mã MSVT cũ '{val_msvt_cu}' đã tồn tại trong database (Bản ghi ID: {db_active_cu[val_msvt_cu]}).")
            elif val_msvt_cu in db_deleted_cu:
                is_duplicate = True
                issues.append(f"Mã MSVT cũ '{val_msvt_cu}' trùng với vùng trồng đã xóa mềm (ID: {db_deleted_cu[val_msvt_cu]}).")

        # 4. Chuẩn hóa số điện thoại
        sdt_clean = normalize_phone(raw_row_vals.get("so_dien_thoai"))

        # 5. Kiểm tra email
        email_clean = clean_text(raw_row_vals.get("email"))
        if email_clean:
            if "@" not in email_clean or "." not in email_clean:
                warnings.append(f"Định dạng email '{email_clean}' có thể không hợp lệ.")

        # 6. Kiểm tra số hộ tham gia
        so_ho_clean = None
        raw_so_ho = raw_row_vals.get("so_ho_tham_gia")
        if raw_so_ho is not None and str(raw_so_ho).strip():
            try:
                # Ép kiểu float rồi sang int nếu là số nguyên
                float_ho = float(str(raw_so_ho).replace(",", "."))
                if float_ho < 0:
                    issues.append(f"Số hộ tham gia mang giá trị âm ({float_ho}).")
                elif not float_ho.is_integer():
                    warnings.append(f"Số hộ tham gia là số thập phân ({float_ho}), làm tròn thành {round(float_ho)}.")
                    so_ho_clean = round(float_ho)
                else:
                    so_ho_clean = int(float_ho)
            except Exception:
                issues.append(f"Số hộ tham gia không hợp lệ: '{raw_so_ho}'.")

        # 7. Kiểm tra diện tích (ha)
        dien_tich_clean = None
        raw_dt = raw_row_vals.get("dien_tich_ha")
        if raw_dt is not None and str(raw_dt).strip():
            try:
                dt_val = float(str(raw_dt).replace(",", "."))
                if dt_val < 0:
                    issues.append(f"Diện tích mang giá trị âm ({dt_val} ha).")
                elif dt_val > 9999999999.9999:
                    issues.append(f"Diện tích vượt quá giới hạn số học cho phép ({dt_val} ha).")
                else:
                    dien_tich_clean = round(dt_val, 4)
            except Exception:
                issues.append(f"Diện tích không phải số hợp lệ: '{raw_dt}'.")

        # 8. Kiểm tra sản lượng
        tong_sl_clean = None
        raw_tsl = raw_row_vals.get("tong_san_luong_tan")
        if raw_tsl is not None and str(raw_tsl).strip():
            try:
                tsl_val = float(str(raw_tsl).replace(",", "."))
                if tsl_val < 0:
                    issues.append(f"Tổng sản lượng mang giá trị âm ({tsl_val} tấn).")
                else:
                    tong_sl_clean = round(tsl_val, 4)
            except Exception:
                issues.append(f"Tổng sản lượng không hợp lệ: '{raw_tsl}'.")

        ns_clean = None
        raw_ns = raw_row_vals.get("san_luong_tan_ha")
        if raw_ns is not None and str(raw_ns).strip():
            try:
                ns_val = float(str(raw_ns).replace(",", "."))
                if ns_val < 0:
                    issues.append(f"Năng suất mang giá trị âm ({ns_val} tấn/ha).")
                else:
                    ns_clean = round(ns_val, 4)
            except Exception:
                issues.append(f"Năng suất không hợp lệ: '{raw_ns}'.")

        # 9. Phân tích và kiểm định tọa độ GPS bằng coord_parser
        raw_coords_str = str(val_toa_do).strip() if val_toa_do is not None else ""
        geom_type = "MISSING"
        area_gis_ha = None
        area_diff_pct = None
        geojson = None

        if not raw_coords_str:
            geom_type = "MISSING"
            warnings.append("Chưa có tọa độ địa lý. Geometry sẽ được lưu là NULL.")
        else:
            coord_res = parse_and_validate_coordinates(raw_coords_str)
            raw_pts = coord_res.get("raw_points", [])
            valid_pts = [p for p in raw_pts if p.get("is_valid") and p.get("lat") is not None and p.get("lng") is not None]
            valid_pts_count = len(valid_pts)
            total_groups = coord_res.get("total_groups", 0)
            groups = coord_res.get("groups", [])

            # Kiểm tra Bounding Box Nghệ An (Lat 18.0 - 20.5, Lon 103.5 - 106.5)
            outside_bbox = False
            for p in valid_pts:
                lat, lng = p["lat"], p["lng"]
                if not (18.0 <= lat <= 20.5 and 103.5 <= lng <= 106.5):
                    outside_bbox = True
                    issues.append(f"Tọa độ ({lat}, {lng}) nằm ngoài phạm vi địa lý tỉnh Nghệ An [18.0-20.5, 103.5-106.5].")
                    geom_type = "INVALID"
                    break

            if not outside_bbox:
                if total_groups > 1:
                    # Nhiều nhóm ranh giới trong 1 ô -> Geometry = NULL theo nguyên tắc an toàn Section X
                    geom_type = "MULTI_GROUP"
                    group_names = [f"{g['name']} ({g['valid_count']}đ)" for g in groups]
                    warnings.append(
                        f"Phát hiện {total_groups} nhóm ranh giới độc lập ({'; '.join(group_names)}). "
                        "Bảo toàn tọa độ gốc, lưu Geometry = NULL chờ cán bộ xác minh thực địa."
                    )
                elif valid_pts_count == 1:
                    # 1 điểm -> Point
                    geom_type = "POINT"
                    p0 = valid_pts[0]
                    geojson = {
                        "type": "Point",
                        "coordinates": [round(p0["lng"], 6), round(p0["lat"], 6)]
                    }
                elif valid_pts_count == 2:
                    # 2 điểm -> INSUFFICIENT
                    geom_type = "INSUFFICIENT"
                    warnings.append("Dữ liệu có 2 điểm GPS, chưa đủ xác định ranh giới Polygon (Geometry = NULL, bảo toàn tọa độ gốc).")
                elif valid_pts_count >= 3:
                    # >= 3 điểm
                    g0 = groups[0] if groups else None
                    if g0 and g0.get("is_valid"):
                        geom_type = "POLYGON"
                        g_pts = g0.get("points", [])
                        ring = [[round(p["lng"], 6), round(p["lat"], 6)] for p in g_pts if p.get("is_valid")]
                        # Khép kín polygon nếu chưa khép kín
                        if ring and ring[0] != ring[-1]:
                            ring.append(ring[0])

                        geojson = {
                            "type": "MultiPolygon",
                            "coordinates": [[ring]]
                        }

                        # Lấy diện tích GIS từ coord_parser
                        calc_area = g0.get("area_ha")
                        if calc_area is not None:
                            area_gis_ha = round(float(calc_area), 2)
                            if dien_tich_clean and dien_tich_clean > 0:
                                diff_abs = abs(area_gis_ha - dien_tich_clean)
                                area_diff_pct = round((diff_abs / dien_tich_clean) * 100.0, 1)
                                if area_diff_pct > 25.0:
                                    warnings.append(
                                        f"Cảnh báo sai lệch diện tích lớn: GIS tính được ~{area_gis_ha} ha, "
                                        f"hồ sơ ghi {dien_tich_clean} ha (chênh lệch {area_diff_pct}%)."
                                    )
                                elif area_diff_pct > 10.0:
                                    warnings.append(
                                        f"Diện tích GIS (~{area_gis_ha} ha) chênh lệch {area_diff_pct}% so với hồ sơ ({dien_tich_clean} ha)."
                                    )

                        if g0.get("is_narrow"):
                            warnings.append("Đa giác ranh giới có tỷ lệ dải rất hẹp, cần kiểm tra lại thứ tự đỉnh.")
                    else:
                        geom_type = "INVALID"
                        g_reason = g0.get("reason", "Lỗi đa giác tự cắt hoặc đảo đỉnh") if g0 else "Không xác định"
                        warnings.append(f"Đa giác không hợp lệ ({g_reason}). Geometry để NULL, bảo toàn tọa độ gốc.")
                else:
                    geom_type = "INVALID"
                    issues.append("Không thể trích xuất tọa độ GPS hợp lệ từ chuỗi tọa độ gốc.")

        # 10. Phân loại trạng thái dòng (Section XIII)
        status_code = "VALID"
        status_label = "Hợp lệ"
        default_selected = True

        if is_duplicate:
            status_code = "DUPLICATE"
            status_label = "Trùng dữ liệu"
            default_selected = False  # Bỏ qua bản ghi trùng theo mặc định (Section VIII)
        elif issues:
            status_code = "INVALID"
            status_label = "Lỗi dữ liệu"
            default_selected = False  # Lỗi thì không được phép chọn
        elif warnings:
            status_code = "WARNING"
            status_label = "Cảnh báo"
            # Trong chế độ kiểm soát nghiêm ngặt: Bản ghi thiếu tọa độ hoặc chỉ có 2 điểm không được chọn mặc định
            default_selected = False if geom_type in ("MISSING", "INSUFFICIENT", "MULTI_GROUP", "INVALID") else True

        row_item = {
            "row_id": row_counter,
            "excel_row": r,
            "section": current_section,
            "msvt_moi": val_msvt_moi,
            "msvt_cu": val_msvt_cu,
            "to_chuc_ca_nhan": val_to_chuc,
            "nguoi_dai_dien": clean_text(raw_row_vals.get("nguoi_dai_dien")),
            "so_dien_thoai": sdt_clean,
            "email": email_clean,
            "toa_do_goc": raw_coords_str or None,
            "dia_chi_msvt": clean_text(raw_row_vals.get("dia_chi_msvt")),
            "loai_cay_trong": clean_text(raw_row_vals.get("loai_cay_trong")),
            "so_ho_tham_gia": so_ho_clean,
            "dien_tich_ha": dien_tich_clean,
            "tong_san_luong_tan": tong_sl_clean,
            "san_luong_tan_ha": ns_clean,
            "quy_trinh": clean_text(raw_row_vals.get("quy_trinh")),
            "thi_truong": clean_text(raw_row_vals.get("thi_truong")),
            "geom_type": geom_type,
            "area_gis_ha": area_gis_ha,
            "area_diff_pct": area_diff_pct,
            "status": status_code,
            "status_label": status_label,
            "issues": issues,
            "warnings": warnings,
            "selected": default_selected,
            "geojson": geojson,
            "raw_values": {k: str(v) if v is not None else None for k, v in raw_row_vals.items()}
        }
        validated_rows.append(row_item)

    # Đếm số lượng theo trạng thái
    total_r = len(validated_rows)
    valid_c = sum(1 for row in validated_rows if row["status"] == "VALID")
    warn_c = sum(1 for row in validated_rows if row["status"] == "WARNING")
    dup_c = sum(1 for row in validated_rows if row["status"] == "DUPLICATE")
    err_c = sum(1 for row in validated_rows if row["status"] == "INVALID")
    sel_c = sum(1 for row in validated_rows if row["selected"])
    tot_area = sum(row["dien_tich_ha"] or 0.0 for row in validated_rows if row["selected"])

    # Cập nhật kết quả DRY RUN vào database
    job.sheet_name = payload.sheet_name
    job.header_row = payload.header_row
    job.data_start_row = payload.data_start_row
    job.mapping_config = mapping
    job.total_rows = total_r
    job.valid_count = valid_c
    job.warning_count = warn_c
    job.duplicate_count = dup_c
    job.error_count = err_c
    job.status = "validated"
    job.validated_rows = validated_rows
    db.commit()

    return ImportSummaryResponse(
        job_id=job.id,
        filename=job.filename,
        sheet_name=job.sheet_name,
        status=job.status,
        total_rows=total_r,
        valid_count=valid_c,
        warning_count=warn_c,
        duplicate_count=dup_c,
        error_count=err_c,
        selected_count=sel_c,
        total_area_ha=round(tot_area, 2),
        created_at=job.created_at
    )


# ==============================================================================
# ENDPOINT 3: XEM TRƯỚC VÀ PHÂN TRANG KẾT QUẢ KIỂM ĐỊNH (PREVIEW)
# ==============================================================================
@router.get("/{job_id}/preview", response_model=ImportPreviewResponse, summary="Xem trước dữ liệu kiểm định phân trang")
def get_import_preview(
    job_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, description="Lọc theo trạng thái: ALL, VALID, WARNING, DUPLICATE, INVALID"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã MSVT, tên tổ chức"),
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Trả về danh sách bản ghi kiểm định có phân trang, hỗ trợ lọc theo trạng thái và tìm kiếm.
    """
    job = db.query(MsvtImportJob).filter(MsvtImportJob.id == job_id).first()
    if not job or not job.validated_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phiên kiểm định không tồn tại hoặc chưa chạy DRY RUN.")

    all_rows: List[Dict[str, Any]] = job.validated_rows

    filtered = all_rows
    if status_filter and status_filter.upper() != "ALL":
        filtered = [r for r in filtered if r["status"] == status_filter.upper()]

    if search and search.strip():
        s = search.strip().lower()
        filtered = [
            r for r in filtered
            if (r.get("msvt_moi") and s in r["msvt_moi"].lower())
            or (r.get("msvt_cu") and s in r["msvt_cu"].lower())
            or (r.get("to_chuc_ca_nhan") and s in r["to_chuc_ca_nhan"].lower())
            or (r.get("loai_cay_trong") and s in r["loai_cay_trong"].lower())
        ]

    total_filtered = len(filtered)
    total_pages = max((total_filtered + page_size - 1) // page_size, 1)
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    items_page = filtered[start_idx:end_idx]

    sel_c = sum(1 for r in all_rows if r.get("selected"))
    tot_area = sum(r.get("dien_tich_ha") or 0.0 for r in all_rows if r.get("selected"))

    summary = ImportSummaryResponse(
        job_id=job.id,
        filename=job.filename,
        sheet_name=job.sheet_name,
        status=job.status,
        total_rows=job.total_rows,
        valid_count=job.valid_count,
        warning_count=job.warning_count,
        duplicate_count=job.duplicate_count,
        error_count=job.error_count,
        selected_count=sel_c,
        total_area_ha=round(tot_area, 2),
        created_at=job.created_at
    )

    return ImportPreviewResponse(
        job_id=job.id,
        total=total_filtered,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        summary=summary,
        items=[ImportRowItem(**r) for r in items_page]
    )


# ==============================================================================
# ENDPOINT 4: CHI TIẾT MỘT DÒNG KIỂM ĐỊNH CHO POPUP BẢN ĐỒ / SO SÁNH
# ==============================================================================
@router.get("/{job_id}/rows/{row_id}", response_model=ImportRowItem, summary="Lấy chi tiết một dòng dữ liệu kiểm định")
def get_import_row_detail(
    job_id: str,
    row_id: int,
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Trả về chi tiết dòng dữ liệu, bao gồm giá trị thô, giá trị chuẩn hóa và GeoJSON để xem trước trên Leaflet.
    """
    job = db.query(MsvtImportJob).filter(MsvtImportJob.id == job_id).first()
    if not job or not job.validated_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên kiểm định.")

    target_row = next((r for r in job.validated_rows if r["row_id"] == row_id), None)
    if not target_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy dòng #{row_id}.")

    return ImportRowItem(**target_row)


# ==============================================================================
# ENDPOINT 5: XÁC NHẬN NHẬP DỮ LIỆU VÀO DATABASE (ATOMIC COMMIT)
# ==============================================================================
@router.post("/{job_id}/commit", response_model=ImportCommitResponse, summary="Xác nhận ghi dữ liệu vào PostgreSQL/PostGIS")
def commit_import_job(
    job_id: str,
    payload: ImportCommitRequest,
    current_user: AdminUser = Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db)
):
    """
    Thực hiện ghi dữ liệu an toàn vào PostgreSQL:
    1. Kiểm tra quyền Admin và CSRF.
    2. Xác minh job ở trạng thái 'validated'.
    3. Mở Transaction PostgreSQL nguyên tử.
    4. Kiểm tra lại trùng MSVT với database mới nhất (chống race condition).
    5. Chỉ INSERT các dòng HỢP LỆ / CẢNH BÁO được người dùng chọn.
    6. Tuyệt đối KHÔNG UPDATE, KHÔNG DROP, KHÔNG XÓA bản ghi hiện có.
    7. Rollback toàn bộ nếu phát sinh lỗi bất ngờ.
    8. Cập nhật trạng thái job thành 'committed'.
    """
    job = db.query(MsvtImportJob).filter(MsvtImportJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên nhập dữ liệu.")

    if job.status == "committed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phiên nhập liệu này đã được thực thi (Committed) trước đó. Không thể thực hiện lại để tránh trùng lặp."
        )

    if job.status != "validated" or not job.validated_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phiên này chưa hoàn tất bước kiểm định (DRY RUN). Vui lòng chạy kiểm định trước khi xác nhận."
        )

    validated_rows: List[Dict[str, Any]] = job.validated_rows
    selected_ids = set(payload.selected_row_ids) if payload.selected_row_ids is not None else None

    # Lọc các dòng được phép commit
    candidate_rows = []
    for r in validated_rows:
        is_selected = (r["row_id"] in selected_ids) if selected_ids is not None else r.get("selected", False)
        # Tuyệt đối không cho phép dòng lỗi (INVALID) đi vào transaction
        if is_selected and r["status"] != "INVALID":
            # Trong chế độ kiểm soát nghiêm ngặt (Section XI):
            # Không âm thầm nhập bản ghi không có geometry (MISSING, INSUFFICIENT, INVALID, MULTI_GROUP)
            if not r.get("geojson") or r.get("geom_type") in ("MISSING", "INSUFFICIENT", "INVALID", "MULTI_GROUP"):
                continue
            candidate_rows.append(r)

    if not candidate_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không có bản ghi hợp lệ có geometry đạt chuẩn nào được chọn để nhập vào cơ sở dữ liệu."
        )

    # 1. Truy vấn kiểm tra lại trùng MSVT ngay trước khi INSERT (chống race condition)
    active_moi_rows = db.execute(
        text("SELECT msvt_moi FROM public.vung_trong WHERE is_deleted = false AND msvt_moi IS NOT NULL")
    ).fetchall()
    active_cu_rows = db.execute(
        text("SELECT msvt_cu FROM public.vung_trong WHERE is_deleted = false AND msvt_cu IS NOT NULL")
    ).fetchall()

    latest_moi = {r[0].strip() for r in active_moi_rows if r[0]}
    latest_cu = {r[0].strip() for r in active_cu_rows if r[0]}

    inserted_ids: List[int] = []
    skipped_count = 0
    total_area_added = 0.0

    try:
        for row in candidate_rows:
            m_moi = row.get("msvt_moi")
            m_cu = row.get("msvt_cu")

            # Bỏ qua nếu xuất hiện xung đột trùng lặp mới
            if (m_moi and m_moi in latest_moi) or (m_cu and m_cu in latest_cu):
                skipped_count += 1
                continue

            # Chuẩn bị câu lệnh INSERT có xử lý PostGIS Geometry
            geo = row.get("geojson")
            geom_type = row.get("geom_type")

            # Xây dựng SQL an toàn với PostGIS
            insert_sql = """
                INSERT INTO public.vung_trong (
                    msvt_moi, msvt_cu, to_chuc_ca_nhan, nguoi_dai_dien,
                    so_dien_thoai, email, toa_do_goc, dia_chi_msvt,
                    loai_cay_trong, so_ho_tham_gia, dien_tich_ha,
                    tong_san_luong_tan, san_luong_tan_ha, quy_trinh,
                    thi_truong, vi_tri, ranh_gioi, is_deleted, created_at, updated_at
                ) VALUES (
                    :msvt_moi, :msvt_cu, :to_chuc_ca_nhan, :nguoi_dai_dien,
                    :so_dien_thoai, :email, :toa_do_goc, :dia_chi_msvt,
                    :loai_cay_trong, :so_ho_tham_gia, :dien_tich_ha,
                    :tong_san_luong_tan, :san_luong_tan_ha, :quy_trinh,
                    :thi_truong,
                    CASE 
                        WHEN CAST(:vi_tri_geojson AS TEXT) IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON(CAST(:vi_tri_geojson AS TEXT)), 4326)
                        WHEN CAST(:ranh_gioi_geojson AS TEXT) IS NOT NULL THEN ST_Centroid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(CAST(:ranh_gioi_geojson AS TEXT))), 4326))
                        ELSE NULL 
                    END,
                    CASE 
                        WHEN CAST(:ranh_gioi_geojson AS TEXT) IS NOT NULL THEN ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(CAST(:ranh_gioi_geojson AS TEXT))), 4326)
                        ELSE NULL 
                    END,
                    FALSE, NOW(), NOW()
                ) RETURNING id;
            """

            vi_tri_json = None
            ranh_gioi_json = None

            if geom_type == "POINT" and geo:
                vi_tri_json = json.dumps(geo)
            elif geom_type == "POLYGON" and geo:
                ranh_gioi_json = json.dumps(geo)

            params = {
                "msvt_moi": m_moi,
                "msvt_cu": m_cu,
                "to_chuc_ca_nhan": row.get("to_chuc_ca_nhan"),
                "nguoi_dai_dien": row.get("nguoi_dai_dien"),
                "so_dien_thoai": row.get("so_dien_thoai"),
                "email": row.get("email"),
                "toa_do_goc": row.get("toa_do_goc"),
                "dia_chi_msvt": row.get("dia_chi_msvt"),
                "loai_cay_trong": row.get("loai_cay_trong"),
                "so_ho_tham_gia": row.get("so_ho_tham_gia"),
                "dien_tich_ha": row.get("dien_tich_ha"),
                "tong_san_luong_tan": row.get("tong_san_luong_tan"),
                "san_luong_tan_ha": row.get("san_luong_tan_ha"),
                "quy_trinh": row.get("quy_trinh"),
                "thi_truong": row.get("thi_truong"),
                "vi_tri_geojson": vi_tri_json,
                "ranh_gioi_geojson": ranh_gioi_json
            }

            res = db.execute(text(insert_sql), params).fetchone()
            if res:
                new_id = res[0]
                inserted_ids.append(new_id)
                if row.get("dien_tich_ha"):
                    total_area_added += float(row["dien_tich_ha"])

                # Cập nhật danh sách MSVT để chống trùng chính các dòng trong cùng transaction
                if m_moi:
                    latest_moi.add(m_moi)
                if m_cu:
                    latest_cu.add(m_cu)

        # Cập nhật trạng thái job
        job.status = "committed"
        job.committed_at = datetime.now()
        job.imported_count = len(inserted_ids)
        job.import_result = {
            "inserted_count": len(inserted_ids),
            "skipped_count": skipped_count,
            "inserted_ids": inserted_ids,
            "total_area_added_ha": round(total_area_added, 2),
            "committed_by": current_user.username
        }

        # Lưu thay đổi (Commit PostgreSQL Transaction)
        db.commit()

    except Exception as e:
        db.rollback()
        logger.error(f"Lỗi khi commit dữ liệu MSVT: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Đã xảy ra lỗi trong quá trình ghi dữ liệu. Toàn bộ thao tác đã được rollback an toàn. Chi tiết: {str(e)}"
        )

    msg = f"Nhập thành công {len(inserted_ids)} vùng trồng mới vào cơ sở dữ liệu."
    if skipped_count > 0:
        msg += f" Đã tự động bỏ qua {skipped_count} bản ghi trùng mã."

    return ImportCommitResponse(
        job_id=job.id,
        message=msg,
        inserted_count=len(inserted_ids),
        skipped_count=skipped_count,
        failed_count=0,
        inserted_ids=inserted_ids,
        total_area_added_ha=round(total_area_added, 2)
    )


# ==============================================================================
# ENDPOINT 6: XUẤT BÁO CÁO NHẬP LIỆU EXCEL 6 SHEET (OPENPYXL)
# ==============================================================================
@router.get("/{job_id}/report", summary="Tải báo cáo kiểm định và nhập liệu Excel 6 sheet")
def export_import_report(
    job_id: str,
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Tạo tệp báo cáo Excel .xlsx gồm 6 sheet chi tiết:
    Sheet 1: Tổng quan nhập liệu
    Sheet 2: Danh sách thêm thành công
    Sheet 3: Danh sách bị bỏ qua do trùng
    Sheet 4: Danh sách lỗi
    Sheet 5: Cảnh báo tọa độ và diện tích
    Sheet 6: Bảng ánh xạ cột Excel và PostgreSQL
    Áp dụng triệt để giải pháp chống Excel Formula Injection.
    """
    job = db.query(MsvtImportJob).filter(MsvtImportJob.id == job_id).first()
    if not job or not job.validated_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy dữ liệu phiên import.")

    wb = openpyxl.Workbook()
    # Xóa sheet mặc định
    if wb.active is not None:
        wb.remove(wb.active)

    # Phong cách định dạng chung
    font_title = Font(name="Calibri", size=14, bold=True, color="1E3A8A")
    font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    font_bold = Font(name="Calibri", size=11, bold=True)
    font_regular = Font(name="Calibri", size=11)
    fill_header = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")

    all_rows: List[Dict[str, Any]] = job.validated_rows or []

    # --------------------------------------------------------------------------
    # SHEET 1: TỔNG QUAN NHẬP LIỆU
    # --------------------------------------------------------------------------
    ws1 = wb.create_sheet(title="Tổng quan")
    ws1["A1"] = "BÁO CÁO KIỂM ĐỊNH VÀ NHẬP DỮ LIỆU MSVT TỪ EXCEL"
    ws1["A1"].font = font_title
    ws1.merge_cells("A1:D1")

    overview_data = [
        ("Mã phiên (Job ID):", job.id),
        ("Tên tệp nguồn:", job.filename),
        ("Sheet dữ liệu:", job.sheet_name or "N/A"),
        ("Người thực hiện:", current_user.username),
        ("Thời điểm tải lên:", job.created_at.strftime("%d/%m/%Y %H:%M:%S") if job.created_at else "N/A"),
        ("Trạng thái phiên:", "Đã nhập vào Database" if job.status == "committed" else "Kiểm định (DRY RUN)"),
        ("Thời điểm commit:", job.committed_at.strftime("%d/%m/%Y %H:%M:%S") if job.committed_at else "Chưa commit"),
        ("", ""),
        ("THỐNG KÊ KẾT QUẢ KIỂM ĐỊNH", ""),
        ("Tổng số dòng dữ liệu:", job.total_rows),
        ("Số dòng hợp lệ (VALID):", job.valid_count),
        ("Số dòng có cảnh báo (WARNING):", job.warning_count),
        ("Số dòng trùng lặp (DUPLICATE):", job.duplicate_count),
        ("Số dòng bị lỗi (INVALID):", job.error_count),
        ("Số bản ghi đã thêm thành công:", job.imported_count),
    ]

    for idx, (label, val) in enumerate(overview_data, start=3):
        ws1.cell(idx, 1, label).font = font_bold if "THỐNG KÊ" in label or not val else font_regular
        ws1.cell(idx, 2, sanitize_formula_injection(val)).font = font_bold if "THỐNG KÊ" in label else font_regular

    # --------------------------------------------------------------------------
    # SHEET 2: DANH SÁCH THÊM THÀNH CÔNG
    # --------------------------------------------------------------------------
    ws2 = wb.create_sheet(title="Thêm thành công")
    headers2 = ["STT", "Dòng Excel", "Mã MSVT mới", "Mã MSVT cũ", "Tổ chức/cá nhân", "Địa chỉ", "Cây trồng", "Diện tích (ha)", "Hình học", "Trạng thái"]
    for c_idx, h in enumerate(headers2, 1):
        cell = ws2.cell(1, c_idx, h)
        cell.font = font_header
        cell.fill = fill_header

    row_out_idx = 2
    for r in all_rows:
        if job.status == "committed" and r.get("selected") and r["status"] in ("VALID", "WARNING"):
            ws2.cell(row_out_idx, 1, row_out_idx - 1)
            ws2.cell(row_out_idx, 2, r["excel_row"])
            ws2.cell(row_out_idx, 3, sanitize_formula_injection(r.get("msvt_moi")))
            ws2.cell(row_out_idx, 4, sanitize_formula_injection(r.get("msvt_cu")))
            ws2.cell(row_out_idx, 5, sanitize_formula_injection(r.get("to_chuc_ca_nhan")))
            ws2.cell(row_out_idx, 6, sanitize_formula_injection(r.get("dia_chi_msvt")))
            ws2.cell(row_out_idx, 7, sanitize_formula_injection(r.get("loai_cay_trong")))
            ws2.cell(row_out_idx, 8, r.get("dien_tich_ha"))
            ws2.cell(row_out_idx, 9, r.get("geom_type"))
            ws2.cell(row_out_idx, 10, "Đã thêm vào DB")
            row_out_idx += 1

    # --------------------------------------------------------------------------
    # SHEET 3: DANH SÁCH BỊ BỎ QUA DO TRÙNG
    # --------------------------------------------------------------------------
    ws3 = wb.create_sheet(title="Trùng lặp bỏ qua")
    headers3 = ["STT", "Dòng Excel", "Mã MSVT mới", "Mã MSVT cũ", "Tổ chức/cá nhân", "Lý do trùng", "Hướng xử lý"]
    for c_idx, h in enumerate(headers3, 1):
        cell = ws3.cell(1, c_idx, h)
        cell.font = font_header
        cell.fill = fill_header

    row_out_idx = 2
    for r in all_rows:
        if r["status"] == "DUPLICATE":
            ws3.cell(row_out_idx, 1, row_out_idx - 1)
            ws3.cell(row_out_idx, 2, r["excel_row"])
            ws3.cell(row_out_idx, 3, sanitize_formula_injection(r.get("msvt_moi")))
            ws3.cell(row_out_idx, 4, sanitize_formula_injection(r.get("msvt_cu")))
            ws3.cell(row_out_idx, 5, sanitize_formula_injection(r.get("to_chuc_ca_nhan")))
            ws3.cell(row_out_idx, 6, sanitize_formula_injection("; ".join(r.get("issues", []))))
            ws3.cell(row_out_idx, 7, "Tự động bỏ qua (không ghi đè)")
            row_out_idx += 1

    # --------------------------------------------------------------------------
    # SHEET 4: DANH SÁCH LỖI
    # --------------------------------------------------------------------------
    ws4 = wb.create_sheet(title="Danh sách lỗi")
    headers4 = ["STT", "Dòng Excel", "Mã MSVT mới", "Mã MSVT cũ", "Tổ chức/cá nhân", "Chi tiết lỗi", "Biện pháp khắc phục"]
    for c_idx, h in enumerate(headers4, 1):
        cell = ws4.cell(1, c_idx, h)
        cell.font = font_header
        cell.fill = fill_header

    row_out_idx = 2
    for r in all_rows:
        if r["status"] == "INVALID":
            ws4.cell(row_out_idx, 1, row_out_idx - 1)
            ws4.cell(row_out_idx, 2, r["excel_row"])
            ws4.cell(row_out_idx, 3, sanitize_formula_injection(r.get("msvt_moi")))
            ws4.cell(row_out_idx, 4, sanitize_formula_injection(r.get("msvt_cu")))
            ws4.cell(row_out_idx, 5, sanitize_formula_injection(r.get("to_chuc_ca_nhan")))
            ws4.cell(row_out_idx, 6, sanitize_formula_injection("; ".join(r.get("issues", []))))
            ws4.cell(row_out_idx, 7, "Chỉnh sửa dữ liệu nguồn trong Excel rồi chạy lại kiểm định")
            row_out_idx += 1

    # --------------------------------------------------------------------------
    # SHEET 5: CẢNH BÁO TỌA ĐỘ VÀ DIỆN TÍCH
    # --------------------------------------------------------------------------
    ws5 = wb.create_sheet(title="Cảnh báo tọa độ - diện tích")
    headers5 = ["STT", "Dòng Excel", "Mã MSVT mới", "Tổ chức/cá nhân", "Diện tích hồ sơ (ha)", "Diện tích GIS (ha)", "Chênh lệch (%)", "Nội dung cảnh báo"]
    for c_idx, h in enumerate(headers5, 1):
        cell = ws5.cell(1, c_idx, h)
        cell.font = font_header
        cell.fill = fill_header

    row_out_idx = 2
    for r in all_rows:
        if r["status"] == "WARNING" or r.get("warnings"):
            ws5.cell(row_out_idx, 1, row_out_idx - 1)
            ws5.cell(row_out_idx, 2, r["excel_row"])
            ws5.cell(row_out_idx, 3, sanitize_formula_injection(r.get("msvt_moi")))
            ws5.cell(row_out_idx, 4, sanitize_formula_injection(r.get("to_chuc_ca_nhan")))
            ws5.cell(row_out_idx, 5, r.get("dien_tich_ha"))
            ws5.cell(row_out_idx, 6, r.get("area_gis_ha"))
            ws5.cell(row_out_idx, 7, r.get("area_diff_pct"))
            ws5.cell(row_out_idx, 8, sanitize_formula_injection("; ".join(r.get("warnings", []))))
            row_out_idx += 1

    # --------------------------------------------------------------------------
    # SHEET 6: BẢNG ÁNH XẠ CỘT EXCEL VÀ POSTGRESQL
    # --------------------------------------------------------------------------
    ws6 = wb.create_sheet(title="Cấu hình ánh xạ cột")
    headers6 = ["STT", "Trường Database PostgreSQL", "Mô tả nghiệp vụ", "Cột Excel đã chọn (Index)"]
    for c_idx, h in enumerate(headers6, 1):
        cell = ws6.cell(1, c_idx, h)
        cell.font = font_header
        cell.fill = fill_header

    mapping_display = [
        ("msvt_moi", "Mã số vùng trồng mới (chuỗi định danh)"),
        ("msvt_cu", "Mã số vùng trồng cũ"),
        ("to_chuc_ca_nhan", "Tổ chức hoặc cá nhân sở hữu"),
        ("nguoi_dai_dien", "Người đại diện pháp luật"),
        ("so_dien_thoai", "Số điện thoại liên lạc"),
        ("email", "Địa chỉ hòm thư điện tử"),
        ("toa_do_goc", "Tọa độ địa lý gốc (Decimal / DMS)"),
        ("dia_chi_msvt", "Địa chỉ vùng trồng"),
        ("loai_cay_trong", "Loại cây trồng"),
        ("so_ho_tham_gia", "Số hộ tham gia canh tác"),
        ("dien_tich_ha", "Diện tích hồ sơ cấp mã (ha)"),
        ("tong_san_luong_tan", "Tổng sản lượng (tấn)"),
        ("san_luong_tan_ha", "Năng suất (tấn/ha)"),
        ("quy_trinh", "Quy trình canh tác (VietGAP, GlobalGAP...)"),
        ("thi_truong", "Thị trường tiêu thụ (Nội địa / Xuất khẩu)")
    ]

    cfg = job.mapping_config or {}
    for idx, (field_k, field_desc) in enumerate(mapping_display, 1):
        col_idx_val = cfg.get(field_k)
        ws6.cell(idx + 1, 1, idx)
        ws6.cell(idx + 1, 2, field_k)
        ws6.cell(idx + 1, 3, field_desc)
        ws6.cell(idx + 1, 4, f"Cột {get_column_letter(col_idx_val)} ({col_idx_val})" if col_idx_val else "Không ánh xạ")

    # Tự động điều chỉnh độ rộng cột trên toàn bộ các sheet
    for sheet in wb.worksheets:
        for col in sheet.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            if col and col[0].column is not None:
                col_letter = get_column_letter(int(col[0].column))
                sheet.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 60)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    report_filename = f"Bao_cao_nhap_MSVT_{job.id}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={report_filename}"}
    )


# ==============================================================================
# ENDPOINT 7: LỊCH SỬ CÁC PHIÊN NHẬP LIỆU EXCEL
# ==============================================================================
@router.get("", response_model=List[ImportJobListItem], summary="Lấy danh sách lịch sử các phiên nhập Excel")
def get_import_history(
    limit: int = Query(20, ge=1, le=100),
    current_user: AdminUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Trả về danh sách lịch sử các phiên nhập Excel gần nhất phục vụ kiểm toán (Audit Log).
    """
    jobs = db.query(MsvtImportJob).order_by(MsvtImportJob.created_at.desc()).limit(limit).all()
    return [
        ImportJobListItem(
            id=j.id,
            filename=j.filename,
            sheet_name=j.sheet_name,
            status=j.status,
            total_rows=j.total_rows,
            valid_count=j.valid_count,
            warning_count=j.warning_count,
            duplicate_count=j.duplicate_count,
            error_count=j.error_count,
            imported_count=j.imported_count,
            created_at=j.created_at,
            committed_at=j.committed_at
        )
        for j in jobs
    ]
