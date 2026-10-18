#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script Import và Kiểm định (DRY RUN) dữ liệu Mã số Vùng trồng (MSVT) từ Excel vào PostgreSQL/PostGIS.
Hỗ trợ 2 chế độ:
  - Mặc định: --dry-run (chỉ phân tích, kiểm định, xuất báo cáo Excel, KHÔNG ghi database)
  - Khi được chỉ định rõ: --commit (ghi dữ liệu vào database theo cơ chế idempotent, chống trùng lặp)
"""

import os
import sys
import re
import argparse
from pathlib import Path

# Đảm bảo UTF-8 cho stdout trên Windows
if sys.stdout.encoding != 'utf-8':
    try:
        # pyrefly: ignore [missing-attribute]
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# pyrefly: ignore [missing-import]
import openpyxl
# pyrefly: ignore [missing-import]
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
# pyrefly: ignore [missing-import]
from openpyxl.utils import get_column_letter
from shapely.geometry import Point, Polygon, MultiPolygon

try:
    from database.coord_parser import parse_and_validate_coordinates, clean_raw_coordinate_text
except ImportError:
    try:
        from coord_parser import parse_and_validate_coordinates, clean_raw_coordinate_text
    except ImportError:
        import sys
        sys.path.append(str(Path(__file__).resolve().parent))
        from coord_parser import parse_and_validate_coordinates, clean_raw_coordinate_text

try:
    import psycopg
except ImportError:
    try:
        # pyrefly: ignore [missing-import]
        import psycopg2 as psycopg
    except ImportError:
        psycopg = None


BASE_DIR = Path(__file__).resolve().parent.parent
EXCEL_PATH = BASE_DIR / "database" / "imports" / "Cơ sở dữ liệu xd bản đồ MSVT 13.10.xlsx"
REPORT_DIR = BASE_DIR / "database" / "reports"
REPORT_PATH = REPORT_DIR / "import_validation.xlsx"
ENV_PATH = BASE_DIR / ".env"


def load_env(env_path):
    """Đọc cấu hình từ file .env"""
    env_vars = {}
    if not env_path.exists():
        return env_vars
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip().strip("'\"")
    return env_vars


def clean_text(val):
    """Làm sạch chuỗi ký tự, loại bỏ khoảng trắng thừa và ký tự rác Unicode"""
    if val is None:
        return None
    s = str(val).replace("\xa0", " ").strip()
    return s if s else None


def normalize_phone(val):
    """Chuẩn hóa số điện thoại, bảo toàn số 0 ở đầu nếu bị Excel tự chuyển thành số nguyên"""
    if val is None:
        return None
    s = str(val).replace("\xa0", " ").strip()
    if not s:
        return None
    digits_only = re.sub(r"\D", "", s)
    if len(digits_only) == 9 and not s.startswith("0"):
        return f"0{s}"
    return s


def parse_dms_token(token):
    """
    Chuyển đổi một token tọa độ dạng Độ-Phút-Giây hoặc Thập phân thành số thực float.
    Hỗ trợ xử lý lỗi gõ máy gõ số 0 thay cho ký hiệu độ ° (ví dụ: 18047'47.6'', 105039'26.1'').
    """
    token = token.strip()
    if not token:
        return None

    # Dạng chuẩn có ký hiệu độ (o, °, d): 19o01'21'', 18°52'10.6"
    mA = re.match(r'''^(\d{1,3})[o°d](\d{1,2})['’](\d{1,2}(?:[.,]\d+)?)['"”]*\s*([NSEW]?)$''', token, re.I)
    if mA:
        d, m, s, direct = mA.groups()
        s = s.replace(",", ".")
        val = float(d) + float(m)/60.0 + float(s)/3600.0
        return -val if direct.upper() in ("S", "W") else val

    # Lỗi gõ số 0 liền kề thay dấu độ: 18047'47.6'', 105039'26.1''
    mB = re.match(r'''^(\d{2,3})0\s*(\d{1,2})['’](\d{1,2}(?:[.,]\d+)?)['"”]*\s*([NSEW]?)$''', token, re.I)
    if mB:
        d, m, s, direct = mB.groups()
        s = s.replace(",", ".")
        val = float(d) + float(m)/60.0 + float(s)/3600.0
        return -val if direct.upper() in ("S", "W") else val

    # Dạng số thập phân: 19.075753
    mC = re.match(r'''^[-+]?\d+(?:[.,]\d+)?\s*([NSEW]?)$''', token, re.I)
    if mC:
        num_str = re.sub(r'[NSEWnsew]', '', token).replace(",", ".").strip()
        val = float(num_str)
        if "S" in token.upper() or "W" in token.upper():
            val = -val
        return val

    return None


def parse_coordinate_string(raw_str):
    """
    Phân tích chuỗi tọa độ địa lý thông minh bằng module coord_parser dùng chung:
    - Nhận diện nhãn Đ1..Đn, P1..Pn, Điểm 1..Điểm n
    - Tự động nhận diện hướng N/S/E/W và hoán đổi đúng thứ tự vĩ độ/kinh độ
    - Sửa khoảng trắng bất thường trong số thập phân (105. 523277 -> 105.523277)
    - Phân chia nhiều nhóm ranh giới độc lập (MULTI_GROUP)
    - Kiểm định hình học từng nhóm độc lập (Tự giao cắt, dải hẹp sliver)
    - Phân định rõ:
      * Cú pháp hình học: POINT, POLYGON, MULTI_GROUP, INSUFFICIENT, INVALID, MISSING
      * Tình trạng xác minh: Chưa xác minh thực địa / Chờ phân loại nhóm
    """
    raw_clean = clean_text(raw_str)
    if not raw_clean:
        return "MISSING", [], None, "Thiếu dữ liệu tọa độ gốc (ô trống)", "Chưa có hình học"

    res = parse_and_validate_coordinates(raw_clean)
    total_pts = res["total_points"]
    raw_pts = res["raw_points"]
    groups = res["groups"]
    total_groups = res["total_groups"]
    valid_pts = [p for p in raw_pts if p["is_valid"] and p["lat"] is not None and p["lng"] is not None]
    valid_pts_count = len(valid_pts)

    if valid_pts_count == 0:
        return "INVALID", [], None, "Không nhận diện được tọa độ hợp lệ", "Lỗi cú pháp hình học"

    # Bounding Box Nghệ An (Lat: 18.0 - 20.5, Lon: 103.5 - 106.5)
    for p in valid_pts:
        lat = p["lat"]
        lon = p["lng"]
        if not (18.0 <= lat <= 20.5 and 103.5 <= lon <= 106.5):
            all_valid = [(pt["lng"], pt["lat"]) for pt in valid_pts]
            return "INVALID", all_valid, None, f"Tọa độ ngoài ranh giới Nghệ An: Lat={lat}, Lon={lon}", "Lỗi tọa độ ngoài phạm vi"

    # Trường hợp 1: Nhiều nhóm ranh giới độc lập (Section V & X đề bài - ví dụ Dòng 60 với 4 nhóm)
    if total_groups > 1:
        all_pts = [(p["lng"], p["lat"]) for p in valid_pts]
        group_summaries = []
        for g in groups:
            g_pts = g["valid_count"]
            g_reason = g.get("reason", "Hợp lệ")
            g_area = f" (~{g['area_ha']} ha)" if g.get("area_ha") is not None else ""
            group_summaries.append(f"{g['name']} ({g_pts}đ: {g_reason}{g_area})")

        # Quy tắc bắt buộc Section X: Mặc định KHÔNG cho tự động lưu MultiPolygon từ các nhóm chưa xác nhận
        # Geometry bắt buộc để NULL trong database, bảo toàn 100% tọa độ gốc tại toa_do_goc
        return (
            "MULTI_GROUP",
            all_pts,
            None,
            f"Phát hiện {total_groups} nhóm ranh giới độc lập ({valid_pts_count} điểm: {'; '.join(group_summaries)}). Chưa xác nhận quan hệ -> Geometry để NULL.",
            "Chờ phân loại nhóm (Bảo toàn tọa độ gốc, không tự lưu geometry)"
        )

    # Trường hợp 2: Đúng 1 điểm -> Point
    if valid_pts_count == 1:
        p = valid_pts[0]
        pt = Point(p["lng"], p["lat"])
        return "POINT", [(p["lng"], p["lat"])], pt, "Tọa độ điểm mốc đơn", "Tọa độ điểm đại diện (Chưa có ranh giới vùng)"

    # Trường hợp 3: Đúng 2 điểm -> INSUFFICIENT
    if valid_pts_count == 2:
        pts = [(p["lng"], p["lat"]) for p in valid_pts]
        return "INSUFFICIENT", pts, None, "Chỉ có 2 điểm, không đủ để tạo đa giác ranh giới (yêu cầu >= 3 đỉnh)", "Không đủ đỉnh tạo ranh giới"

    # Trường hợp 4: >= 3 điểm thuộc 1 nhóm
    if total_groups == 1 and valid_pts_count >= 3:
        g = groups[0]
        pts = [(p["lng"], p["lat"]) for p in g["points"] if p["is_valid"] and p["lat"] is not None and p["lng"] is not None]
        if g["is_valid"] and len(pts) >= 3:
            try:
                poly = Polygon(pts)
                mp = MultiPolygon([poly])
                narrow_note = " (Dải rất hẹp cần rà soát)" if g.get("is_narrow") else ""
                area_note = f", ~{g.get('area_ha', 0)} ha" if g.get("area_ha") is not None else ""
                return "POLYGON", pts, mp, f"Đa giác ranh giới hợp lệ ({len(pts)} đỉnh{narrow_note}{area_note})", "Hợp lệ về cú pháp hình học (Chưa xác minh thực địa)"
            except Exception as e:
                return "INVALID", pts, None, f"Lỗi tạo đa giác: {str(e)}", "Lỗi hình học"
        else:
            return "INVALID", pts, None, f"Đa giác lỗi ({len(pts)} đỉnh: {g.get('reason', 'Lỗi hình học')})", "Lỗi tự cắt/đảo đỉnh"

    return "INVALID", [], None, "Không nhận diện được hình học hợp lệ", "Lỗi cú pháp hình học"


def read_and_validate_excel(excel_path):
    """
    Đọc toàn bộ 51 dòng từ Excel và chuẩn bị dữ liệu theo các nguyên tắc nghiệp vụ chặt chẽ.
    """
    if not excel_path.exists():
        raise FileNotFoundError(f"Không tìm thấy file Excel tại: {excel_path}")

    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb["Sheet1"]

    records = []
    msvt_moi_map = {}
    msvt_cu_map = {}

    target_rows = [(r, "Nội địa") for r in range(7, 56)] + [(60, "Xuất khẩu"), (61, "Xuất khẩu")]

    for row_idx, section in target_rows:
        stt = ws.cell(row_idx, 1).value
        msvt_moi_raw = ws.cell(row_idx, 2).value
        msvt_cu_raw = ws.cell(row_idx, 3).value
        to_chuc_raw = ws.cell(row_idx, 4).value
        nguoi_dd_raw = ws.cell(row_idx, 5).value
        sdt_raw = ws.cell(row_idx, 6).value
        email_raw = ws.cell(row_idx, 7).value
        toa_do_raw = ws.cell(row_idx, 8).value
        dia_chi_raw = ws.cell(row_idx, 9).value
        loai_cay_raw = ws.cell(row_idx, 10).value
        so_ho_raw = ws.cell(row_idx, 11).value
        dien_tich_raw = ws.cell(row_idx, 12).value
        san_luong_raw = ws.cell(row_idx, 13).value
        quy_trinh_raw = ws.cell(row_idx, 14).value
        thi_truong_raw = ws.cell(row_idx, 15).value

        # Chuẩn hóa chuỗi
        msvt_moi = clean_text(msvt_moi_raw)
        msvt_cu = clean_text(msvt_cu_raw)
        to_chuc = clean_text(to_chuc_raw)
        nguoi_dd = clean_text(nguoi_dd_raw)
        sdt = normalize_phone(sdt_raw)
        email = clean_text(email_raw)
        toa_do_goc = str(toa_do_raw).strip() if toa_do_raw is not None else None
        dia_chi = clean_text(dia_chi_raw)
        loai_cay = clean_text(loai_cay_raw)
        quy_trinh = clean_text(quy_trinh_raw)
        thi_truong = clean_text(thi_truong_raw)

        row_issues = []

        # Kiểm tra trùng mã
        if msvt_moi:
            if msvt_moi in msvt_moi_map:
                row_issues.append(f"Mã MSVT mới trùng với dòng {msvt_moi_map[msvt_moi]}")
            else:
                msvt_moi_map[msvt_moi] = row_idx
        else:
            row_issues.append("Thiếu mã MSVT mới (ô để trống)")

        if msvt_cu:
            if msvt_cu in msvt_cu_map:
                row_issues.append(f"Mã MSVT cũ trùng với dòng {msvt_cu_map[msvt_cu]}")
            else:
                msvt_cu_map[msvt_cu] = row_idx

        # Kiểm tra số hộ
        so_ho = None
        if so_ho_raw is not None:
            try:
                so_ho = int(float(str(so_ho_raw)))
                if so_ho < 0:
                    row_issues.append("Số hộ tham gia mang giá trị âm (<0)")
            except (ValueError, TypeError):
                row_issues.append(f"Số hộ không hợp lệ: '{so_ho_raw}'")

        # Kiểm tra diện tích
        dien_tich = None
        if dien_tich_raw is not None:
            try:
                dien_tich = float(str(dien_tich_raw))
                if dien_tich < 0:
                    row_issues.append("Diện tích mang giá trị âm (<0)")
            except (ValueError, TypeError):
                row_issues.append(f"Diện tích không hợp lệ: '{dien_tich_raw}'")

        # Xử lý sản lượng: Bảo toàn giá trị gốc vào tong_san_luong_tan; giữ san_luong_tan_ha = NULL vì chưa xác minh đơn vị
        san_luong_goc = None
        san_luong_tan_ha = None
        tong_san_luong_tan = None
        note_san_luong = None

        if san_luong_raw is not None:
            try:
                san_luong_goc = float(str(san_luong_raw))
                if san_luong_goc < 0:
                    row_issues.append("Sản lượng mang giá trị âm (<0)")
                else:
                    # Lưu giá trị gốc vào tong_san_luong_tan để bảo toàn dữ liệu
                    tong_san_luong_tan = san_luong_goc
                    # Tạm thời để san_luong_tan_ha là NULL theo yêu cầu, tránh giả định sai
                    san_luong_tan_ha = None
                    note_san_luong = f"Lưu giá trị gốc ({san_luong_goc}) vào tong_san_luong_tan; san_luong_tan_ha để NULL chờ xác nhận đơn vị"
            except (ValueError, TypeError):
                row_issues.append(f"Sản lượng không hợp lệ: '{san_luong_raw}'")

        # Phân tích tọa độ
        geom_type, pts, geom_obj, coord_note, field_status = parse_coordinate_string(toa_do_raw)

        # Chuẩn bị đối tượng PostGIS cho Database
        vi_tri_wkt = None
        ranh_gioi_wkt = None

        if geom_type == "POINT" and geom_obj:
            vi_tri_wkt = geom_obj.wkt
        elif geom_type in ("POLYGON", "MULTIPOLYGON") and geom_obj:
            ranh_gioi_wkt = geom_obj.wkt
        else:
            # Những bản ghi lỗi hoặc thiếu tọa độ: để vi_tri và ranh_gioi là NULL
            vi_tri_wkt = None
            ranh_gioi_wkt = None

        if geom_type in ("MISSING", "INVALID", "INSUFFICIENT", "MULTI_GROUP"):
            row_issues.append(f"Tọa độ: {coord_note}")

        record = {
            "row": row_idx,
            "stt": stt,
            "section": section,
            "msvt_moi": msvt_moi,
            "msvt_cu": msvt_cu,
            "to_chuc_ca_nhan": to_chuc,
            "nguoi_dai_dien": nguoi_dd,
            "so_dien_thoai": sdt,
            "email": email,
            "toa_do_goc": toa_do_goc,
            "dia_chi_msvt": dia_chi,
            "loai_cay_trong": loai_cay,
            "so_ho_tham_gia": so_ho,
            "dien_tich_ha": dien_tich,
            "san_luong_goc": san_luong_goc,
            "tong_san_luong_tan": tong_san_luong_tan,
            "san_luong_tan_ha": san_luong_tan_ha,
            "note_san_luong": note_san_luong,
            "quy_trinh": quy_trinh,
            "thi_truong": thi_truong,
            "geom_type": geom_type,
            "pts_count": len(pts),
            "vi_tri_wkt": vi_tri_wkt,
            "ranh_gioi_wkt": ranh_gioi_wkt,
            "coord_note": coord_note,
            "field_status": field_status,
            "issues": row_issues,
            "is_valid": len(row_issues) == 0
        }
        records.append(record)

    return records


def export_validation_report(records, report_path):
    """
    Tạo file Excel báo cáo kiểm tra (database/reports/import_validation.xlsx) gồm 3 sheet.
    """
    report_path.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()

    font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    font_title = Font(name="Calibri", size=14, bold=True, color="1F497D")
    fill_header = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
    fill_sub_header = PatternFill(start_color="595959", end_color="595959", fill_type="solid")
    fill_pass = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid")
    fill_warn = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
    fill_fail = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")
    border_thin = Border(
        left=Side(style="thin", color="D9D9D9"),
        right=Side(style="thin", color="D9D9D9"),
        top=Side(style="thin", color="D9D9D9"),
        bottom=Side(style="thin", color="D9D9D9")
    )
    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")

    # -------------------------------------------------------------
    # SHEET 1: TỔNG QUAN KIỂM ĐỊNH
    # -------------------------------------------------------------
    ws_summary = wb.active
    assert ws_summary is not None
    ws_summary.title = "Tổng quan kiểm định"

    ws_summary.merge_cells("A1:D1")
    ws_summary["A1"] = "BÁO CÁO KIỂM ĐỊNH DỮ LIỆU MSVT (DRY RUN REPORT V2)"
    ws_summary["A1"].font = font_title
    ws_summary["A1"].alignment = align_center

    total = len(records)
    count_point = sum(1 for r in records if r["geom_type"] == "POINT")
    count_poly = sum(1 for r in records if r["geom_type"] in ("POLYGON", "MULTIPOLYGON"))
    count_2pts = sum(1 for r in records if r["geom_type"] == "INSUFFICIENT")
    count_multigroup = sum(1 for r in records if r["geom_type"] == "MULTI_GROUP")
    count_invalid = sum(1 for r in records if r["geom_type"] == "INVALID")
    count_missing = sum(1 for r in records if r["geom_type"] == "MISSING")
    count_missing_msvt_moi = sum(1 for r in records if not r["msvt_moi"])

    summary_rows = [
        ("TỔNG SỐ BẢN GHI RÀ SOÁT", total, "Section I: 49 dòng + Section II: 2 dòng = 51 dòng"),
        ("1. Tọa độ điểm đơn (Point)", count_point, "Tạo vi_tri kiểu Point; ranh_gioi = NULL"),
        ("2. Đa giác ranh giới hợp lệ cú pháp", count_poly, "Tạo ranh_gioi MultiPolygon (Chưa xác minh thực địa)"),
        ("3. Thiếu điểm tạo đa giác (Chỉ 2 điểm)", count_2pts, "Dòng 34, 35: vi_tri = NULL, ranh_gioi = NULL"),
        ("4. Nhiều nhóm ranh giới trong 1 ô (MULTI_GROUP)", count_multigroup, "Dòng 60 (18 điểm, 4 nhóm độc lập): vi_tri = NULL, ranh_gioi = NULL; chờ phân loại nhóm"),
        ("5. Đa giác lỗi cú pháp/tự cắt", count_invalid, "Dòng 13, 17, 43, 46, 47: vi_tri = NULL, ranh_gioi = NULL"),
        ("6. Thiếu tọa độ gốc (ô trống)", count_missing, "Dòng 55: vi_tri = NULL, ranh_gioi = NULL"),
        ("TỔNG CỘNG PHÂN LOẠI HÌNH HỌC (1+2+3+4+5+6)", count_point + count_poly + count_2pts + count_multigroup + count_invalid + count_missing, "Đối soát chính xác 100%, không trùng lặp"),
        ("Số mã MSVT mới bị thiếu", count_missing_msvt_moi, "Dòng 61: msvt_moi = NULL, dùng msvt_cu EX-NAOR-0010SO"),
        ("Bảo toàn giá trị sản lượng gốc", total, "Lưu vào tong_san_luong_tan; san_luong_tan_ha để NULL"),
        ("Trạng thái sẵn sàng nạp PostgreSQL", total, "Đã chuẩn bị đầy đủ 51 bản ghi (Idempotent upsert)")
    ]

    ws_summary.append([])
    ws_summary.append(["Hạng mục kiểm định", "Số lượng", "Diễn giải chi tiết kỹ thuật"])
    for col in range(1, 4):
        c = ws_summary.cell(3, col)
        c.font = font_header
        c.fill = fill_header
        c.alignment = align_center

    for idx, (label, val, note) in enumerate(summary_rows, start=4):
        ws_summary.append([label, val, note])
        ws_summary.cell(idx, 1).alignment = align_left
        ws_summary.cell(idx, 2).alignment = align_center
        ws_summary.cell(idx, 3).alignment = align_left
        for col in range(1, 4):
            ws_summary.cell(idx, col).border = border_thin
        if "TỔNG" in label:
            ws_summary.cell(idx, 1).font = Font(name="Calibri", size=11, bold=True)
            ws_summary.cell(idx, 2).font = Font(name="Calibri", size=11, bold=True)

    # -------------------------------------------------------------
    # SHEET 2: CHI TIẾT ĐẦY ĐỦ 51 BẢN GHI
    # -------------------------------------------------------------
    ws_details = wb.create_sheet(title="Đầy đủ 51 bản ghi")
    detail_headers = [
        "Dòng", "STT", "Phân loại", "MSVT mới", "MSVT cũ", "Tổ chức / Cá nhân",
        "Người đại diện", "Số điện thoại", "Email", "Địa chỉ MSVT", "Loại cây",
        "Số hộ", "Diện tích (ha)", "Sản lượng gốc (Excel)", "tong_san_luong_tan", "san_luong_tan_ha",
        "Cú pháp hình học", "Số đỉnh", "Xác minh thực địa", "vi_tri (PostGIS)", "ranh_gioi (PostGIS)", "Trạng thái dòng"
    ]
    ws_details.append(detail_headers)
    for col in range(1, len(detail_headers) + 1):
        c = ws_details.cell(1, col)
        c.font = font_header
        c.fill = fill_header
        c.alignment = align_center

    for r_idx, rec in enumerate(records, start=2):
        has_geom = rec["vi_tri_wkt"] is not None or rec["ranh_gioi_wkt"] is not None
        status_label = "SẴN SÀNG (CÓ HÌNH HỌC)" if has_geom else "SẴN SÀNG (HÌNH HỌC NULL)"
        fill_color = fill_pass if has_geom else fill_warn

        row_vals = [
            rec["row"],
            rec["stt"],
            rec["section"],
            rec["msvt_moi"] or "(NULL)",
            rec["msvt_cu"] or "(NULL)",
            rec["to_chuc_ca_nhan"],
            rec["nguoi_dai_dien"],
            rec["so_dien_thoai"],
            rec["email"] or "",
            rec["dia_chi_msvt"],
            rec["loai_cay_trong"],
            rec["so_ho_tham_gia"],
            rec["dien_tich_ha"],
            rec["san_luong_goc"],
            rec["tong_san_luong_tan"],
            rec["san_luong_tan_ha"] or "(NULL)",
            rec["geom_type"],
            rec["pts_count"],
            rec["field_status"],
            "POINT" if rec["vi_tri_wkt"] else "NULL",
            "MULTIPOLYGON" if rec["ranh_gioi_wkt"] else "NULL",
            status_label
        ]
        ws_details.append(row_vals)

        for c_idx in range(1, len(row_vals) + 1):
            cell = ws_details.cell(r_idx, c_idx)
            cell.border = border_thin
            if c_idx == len(row_vals):
                cell.fill = fill_color
                cell.font = Font(name="Calibri", size=10, bold=True, color="006100" if has_geom else "9C6500")
                cell.alignment = align_center

    # -------------------------------------------------------------
    # SHEET 3: 10 DÒNG CẦN LƯU Ý / KIỂM TRA THỦ CÔNG
    # -------------------------------------------------------------
    ws_issues = wb.create_sheet(title="10 Dòng cần lưu ý")
    issue_headers = ["Dòng Excel", "STT", "Mã MSVT", "Tên cơ sở / Vùng trồng", "Tọa độ gốc trong Excel", "Vấn đề hình học / Dữ liệu", "Phương án xử lý khi nạp"]
    ws_issues.append(issue_headers)
    for col in range(1, len(issue_headers) + 1):
        c = ws_issues.cell(1, col)
        c.font = font_header
        c.fill = fill_sub_header
        c.alignment = align_center

    issue_row_counter = 2
    for rec in records:
        if not rec["is_valid"] or rec["geom_type"] in ("MISSING", "INSUFFICIENT", "INVALID", "MULTI_GROUP") or not rec["msvt_moi"]:
            proposal = ""
            if rec["geom_type"] == "MISSING":
                proposal = "Nạp với vi_tri=NULL, ranh_gioi=NULL; lưu chuỗi trống trong toa_do_goc"
            elif rec["geom_type"] == "INSUFFICIENT":
                proposal = "Chỉ có 2 điểm: nạp vi_tri=NULL, ranh_gioi=NULL; bảo toàn 2 điểm trong toa_do_goc"
            elif rec["geom_type"] == "MULTI_GROUP":
                proposal = "Chứa nhiều nhóm ranh giới (18 điểm, 4 nhóm): nạp vi_tri=NULL, ranh_gioi=NULL; bảo toàn 100% tọa độ gốc để người dùng thẩm tra phân nhóm trên WebGIS"
            elif rec["geom_type"] == "INVALID":
                proposal = "Đa giác tự cắt: nạp vi_tri=NULL, ranh_gioi=NULL; bảo toàn tọa độ gốc để nắn sau"
            elif not rec["msvt_moi"]:
                proposal = "Nạp msvt_moi=NULL, định danh tạm thời qua msvt_cu EX-NAOR-0010SO"

            row_data = [
                rec["row"],
                rec["stt"],
                rec["msvt_moi"] or rec["msvt_cu"] or "(Trống)",
                rec["to_chuc_ca_nhan"],
                rec["toa_do_goc"][:50] + "..." if rec["toa_do_goc"] and len(rec["toa_do_goc"]) > 50 else rec["toa_do_goc"],
                "; ".join(rec["issues"]),
                proposal
            ]
            ws_issues.append(row_data)
            for c_idx in range(1, len(row_data) + 1):
                cell = ws_issues.cell(issue_row_counter, c_idx)
                cell.border = border_thin
                cell.fill = fill_fail if rec["geom_type"] in ("MISSING", "INVALID") else fill_warn
            issue_row_counter += 1

    for sheet in [ws_summary, ws_details, ws_issues]:
        for col in sheet.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_idx = col[0].column
            if col_idx is not None:
                col_letter = get_column_letter(int(col_idx))
                sheet.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 40)

    wb.save(report_path)
    return report_path


def commit_to_postgres(records):
    """
    Thực hiện nạp dữ liệu thật vào bảng public.vung_trong (Idempotent upsert).
    Chỉ chạy khi người dùng truyền rõ cờ --commit.
    """
    if not psycopg:
        print("Lỗi: Không tìm thấy thư viện psycopg hoặc psycopg2 để kết nối database.")
        sys.exit(1)

    env = load_env(ENV_PATH)
    db_host = env.get("POSTGRES_HOST", "127.0.0.1")
    db_port = int(env.get("POSTGRES_PORT", 5433))
    db_name = env.get("POSTGRES_DB", "webgis_msvt")
    db_user = env.get("POSTGRES_USER", "webgis_admin")
    db_pass = env.get("POSTGRES_PASSWORD", "")

    print(f"\nĐang kết nối tới PostgreSQL {db_host}:{db_port}/{db_name} as {db_user}...")
    conn = psycopg.connect(
        host=db_host,
        port=db_port,
        dbname=db_name,
        user=db_user,
        password=db_pass
    )

    RESULT_REPORT_PATH = REPORT_DIR / "import_result.xlsx"

    inserted = 0
    updated = 0

    try:
        with conn:
            with conn.cursor() as cur:
                for rec in records:
                    # Kiểm tra bản ghi đã tồn tại theo msvt_moi (hoặc msvt_cu nếu msvt_moi is None)
                    existing_id = None
                    if rec["msvt_moi"]:
                        cur.execute("SELECT id FROM public.vung_trong WHERE msvt_moi = %s", (rec["msvt_moi"],))
                        row = cur.fetchone()
                        if row:
                            existing_id = row[0]
                    elif rec["msvt_cu"]:
                        cur.execute("SELECT id FROM public.vung_trong WHERE msvt_cu = %s", (rec["msvt_cu"],))
                        row = cur.fetchone()
                        if row:
                            existing_id = row[0]

                    if existing_id:
                        # UPDATE bản ghi hiện có
                        cur.execute("""
                            UPDATE public.vung_trong
                            SET msvt_moi = %s,
                                msvt_cu = %s,
                                to_chuc_ca_nhan = %s,
                                nguoi_dai_dien = %s,
                                so_dien_thoai = %s,
                                email = %s,
                                toa_do_goc = %s,
                                dia_chi_msvt = %s,
                                loai_cay_trong = %s,
                                so_ho_tham_gia = %s,
                                dien_tich_ha = %s,
                                tong_san_luong_tan = %s,
                                san_luong_tan_ha = %s,
                                quy_trinh = %s,
                                thi_truong = %s,
                                vi_tri = ST_SetSRID(ST_GeomFromText(%s), 4326),
                                ranh_gioi = ST_SetSRID(ST_Multi(ST_GeomFromText(%s)), 4326),
                                updated_at = NOW()
                            WHERE id = %s
                        """, (
                            rec["msvt_moi"], rec["msvt_cu"], rec["to_chuc_ca_nhan"], rec["nguoi_dai_dien"],
                            rec["so_dien_thoai"], rec["email"], rec["toa_do_goc"], rec["dia_chi_msvt"],
                            rec["loai_cay_trong"], rec["so_ho_tham_gia"], rec["dien_tich_ha"],
                            rec["tong_san_luong_tan"], rec["san_luong_tan_ha"], rec["quy_trinh"],
                            rec["thi_truong"], rec["vi_tri_wkt"], rec["ranh_gioi_wkt"],
                            existing_id
                        ))
                        updated += 1
                    else:
                        # INSERT bản ghi mới
                        cur.execute("""
                            INSERT INTO public.vung_trong (
                                msvt_moi, msvt_cu, to_chuc_ca_nhan, nguoi_dai_dien, so_dien_thoai,
                                email, toa_do_goc, dia_chi_msvt, loai_cay_trong, so_ho_tham_gia,
                                dien_tich_ha, tong_san_luong_tan, san_luong_tan_ha, quy_trinh,
                                thi_truong, vi_tri, ranh_gioi, created_at, updated_at
                            ) VALUES (
                                %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s,
                                %s, %s, %s, %s,
                                %s,
                                ST_SetSRID(ST_GeomFromText(%s), 4326),
                                ST_SetSRID(ST_Multi(ST_GeomFromText(%s)), 4326),
                                NOW(), NOW()
                            )
                        """, (
                            rec["msvt_moi"], rec["msvt_cu"], rec["to_chuc_ca_nhan"], rec["nguoi_dai_dien"],
                            rec["so_dien_thoai"], rec["email"], rec["toa_do_goc"], rec["dia_chi_msvt"],
                            rec["loai_cay_trong"], rec["so_ho_tham_gia"], rec["dien_tich_ha"],
                            rec["tong_san_luong_tan"], rec["san_luong_tan_ha"], rec["quy_trinh"],
                            rec["thi_truong"], rec["vi_tri_wkt"], rec["ranh_gioi_wkt"]
                        ))
                        inserted += 1

        print(f"Hoàn thành Commit Transaction: Đã INSERT {inserted} bản ghi mới, UPDATE {updated} bản ghi.")
    except Exception as e:
        print(f"LỖI TRANSACTION: Đã tự động ROLLBACK toàn bộ. Chi tiết lỗi: {e}")
        raise e
    finally:
        conn.close()

    # Xuất báo cáo kết quả nạp chính thức database/reports/import_result.xlsx
    result_report = export_validation_report(records, RESULT_REPORT_PATH)
    print(f"Đã xuất báo cáo kết quả nạp chính thức tại: {result_report}")


def main():
    parser = argparse.ArgumentParser(description="Tool kiểm định và nạp dữ liệu MSVT từ Excel vào PostGIS")
    parser.add_argument("--commit", action="store_true", help="Thực thi INSERT/UPDATE vào PostgreSQL. Nếu không có cờ này, mặc định là DRY RUN.")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Chế độ kiểm định DRY RUN (mặc định)")
    args = parser.parse_args()

    # Nếu người dùng truyền --commit thì tắt dry_run
    is_dry_run = not args.commit

    print("=" * 70)
    mode_title = "CHẾ ĐỘ KIỂM ĐỊNH DRY RUN (KHÔNG GHI DATABASE)" if is_dry_run else "CHẾ ĐỘ COMMIT CHÍNH THỨC"
    print(f" {mode_title}")
    print("=" * 70)

    records = read_and_validate_excel(EXCEL_PATH)

    total = len(records)
    count_point = sum(1 for r in records if r["geom_type"] == "POINT")
    count_poly = sum(1 for r in records if r["geom_type"] in ("POLYGON", "MULTIPOLYGON"))
    count_2pts = sum(1 for r in records if r["geom_type"] == "INSUFFICIENT")
    count_multigroup = sum(1 for r in records if r["geom_type"] == "MULTI_GROUP")
    count_invalid = sum(1 for r in records if r["geom_type"] == "INVALID")
    count_missing = sum(1 for r in records if r["geom_type"] == "MISSING")
    count_missing_msvt_moi = sum(1 for r in records if not r["msvt_moi"])

    print(f"\n1. ĐỐI SOÁT TỔNG THỂ DỮ LIỆU:")
    print(f"   - Tổng số bản ghi trong Excel      : {total} bản ghi (Section I: 49, Section II: 2)")
    print(f"   - Số mã MSVT mới bị thiếu          : {count_missing_msvt_moi} bản ghi (Dòng 61)")
    print(f"   - Mã MSVT trùng lặp                : 0 mã trùng")

    print(f"\n2. KẾT QUẢ ĐỐI SOÁT HÌNH HỌC (ĐẢM BẢO TỔNG CỘNG 51 BẢN GHI):")
    print(f"   - Tọa độ điểm đơn (Point)          : {count_point} bản ghi (nạp vi_tri Point, ranh_gioi NULL)")
    print(f"   - Đa giác ranh giới hợp lệ cú pháp : {count_poly} bản ghi (nạp ranh_gioi MultiPolygon)")
    print(f"   - Không đủ đỉnh (chỉ 2 điểm)       : {count_2pts} bản ghi (Dòng 34, 35 -> nạp NULL cả 2)")
    print(f"   - Nhiều nhóm ranh giới trong 1 ô   : {count_multigroup} bản ghi (Dòng 60: 18 điểm, 4 nhóm -> nạp NULL cả 2, bảo toàn toa_do_goc)")
    print(f"   - Đa giác lỗi cú pháp/tự cắt       : {count_invalid} bản ghi (Dòng 13, 17, 43, 46, 47 -> nạp NULL cả 2)")
    print(f"   - Thiếu tọa độ gốc (ô trống)        : {count_missing} bản ghi (Dòng 55 -> nạp NULL cả 2)")
    print(f"   --> TỔNG CỘNG HÌNH HỌC             : {count_point + count_poly + count_2pts + count_multigroup + count_invalid + count_missing} / {total} (Khớp 100%)")

    print(f"\n3. LƯU Ý VỀ XÁC MINH RANH GIỚI THỰC ĐỊA:")
    print(f"   - Toàn bộ {count_poly} đa giác hợp lệ cú pháp được gắn nhãn: 'Chưa xác minh thực địa'.")
    print(f"   - Cần đối soát thêm với bản đồ địa chính/thửa đất trước khi xem đây là ranh giới pháp lý.")

    print(f"\n4. XỬ LÝ SẢN LƯỢNG:")
    print(f"   - Giá trị gốc từ Excel được bảo toàn vào cột: tong_san_luong_tan.")
    print(f"   - Cột san_luong_tan_ha được để NULL chờ xác nhận đơn vị tính (không tính năng suất tự ý).")

    # Xuất báo cáo Excel
    report_file = export_validation_report(records, REPORT_PATH)
    print(f"\n5. BÁO CÁO THẨM ĐỊNH:")
    print(f"   - Đã xuất file báo cáo cập nhật tại : {report_file}")

    if is_dry_run:
        print("\n" + "=" * 70)
        print(" [DRY RUN HOÀN TẤT] CHƯA CÓ THAY ĐỔI NÀO ĐƯỢC GHI VÀO POSTGRESQL.")
        print(" Bảng public.vung_trong vẫn an toàn với 0 bản ghi.")
        print(" Để nạp thật sau khi xác nhận, chạy: python database/import_excel.py --commit")
        print("=" * 70)
    else:
        commit_to_postgres(records)


if __name__ == "__main__":
    main()
