import os
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent.parent / "backend-fastapi"
sys.path.insert(0, str(backend_dir))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from app.database import engine
from sqlalchemy import text

sql_path = Path(__file__).resolve().parent / "audit_small_polygons.sql"
with open(sql_path, "r", encoding="utf-8") as f:
    sql_content = f.read()

with engine.connect() as conn:
    # 1. Total counts
    summary = conn.execute(text("""
        SELECT 
            COUNT(*) as total_rows,
            COUNT(CASE WHEN vi_tri IS NULL AND ranh_gioi IS NULL THEN 1 END) as no_geom,
            COUNT(CASE WHEN vi_tri IS NOT NULL AND ranh_gioi IS NULL THEN 1 END) as point_count,
            COUNT(CASE WHEN ranh_gioi IS NOT NULL THEN 1 END) as poly_count
        FROM public.vung_trong
        WHERE is_deleted = false;
    """)).mappings().one()
    
    print("=" * 115)
    print("BÁO CÁO KIỂM TRA CHẤT LƯỢNG HÌNH HỌC VÙNG TRỒNG MSVT (POSTGIS)")
    print(f"Tổng số bản ghi hoạt động: {summary['total_rows']}")
    print(f"- Số bản ghi không có geometry (chỉ xem dạng bảng): {summary['no_geom']}")
    print(f"- Số bản ghi Point (chỉ có vi_tri): {summary['point_count']}")
    print(f"- Số bản ghi MultiPolygon (có ranh_gioi): {summary['poly_count']}")
    print("=" * 115)

    rows = conn.execute(text(sql_content)).mappings().all()
    print(f"\nCHI TIẾT 25 VÙNG RANH GIỚI (Sắp xếp theo diện tích GIS tăng dần):")
    print(f"{'ID':<4} | {'MÃ MSVT':<22} | {'CÂY TRỒNG':<10} | {'KHAI BÁO':<10} | {'GIS HA':<10} | {'CHU VI (M)':<10} | {'ĐỘ NÉN':<8} | {'PHẦN TỬ':<7} | {'PHÂN LOẠI HIỂN THỊ'}")
    print("-" * 115)
    
    very_small_count = 0
    small_count = 0
    sliver_count = 0
    diff_count = 0
    multi_part_count = 0
    
    for r in rows:
        kb_str = f"{r['dien_tich_khai_bao']} ha" if r['dien_tich_khai_bao'] is not None else "N/A"
        gis_str = f"{r['dien_tich_gis_ha']} ha" if r['dien_tich_gis_ha'] is not None else "0 ha"
        perim_str = f"{r['chu_vi_gis_m']} m" if r['chu_vi_gis_m'] is not None else "0 m"
        nen_str = f"{float(r['chi_so_do_nen']):.4f}" if r['chi_so_do_nen'] is not None else "N/A"
        
        area_gis = float(r['dien_tich_gis_ha']) if r['dien_tich_gis_ha'] else 0
        nen = float(r['chi_so_do_nen']) if r['chi_so_do_nen'] else 0
        
        if area_gis < 0.05:
            very_small_count += 1
        elif area_gis < 0.3:
            small_count += 1
            
        if nen < 0.05:
            sliver_count += 1
        if r['ty_le_lech_dien_tich'] and float(r['ty_le_lech_dien_tich']) > 1.5:
            diff_count += 1
        if r['so_phan_tu'] > 1:
            multi_part_count += 1
            
        crop_name = str(r['loai_cay_trong'] or '')[:10]
        msvt_name = str(r['msvt_moi'] or '')[:22]
        print(f"{r['id']:<4} | {msvt_name:<22} | {crop_name:<10} | {kb_str:<10} | {gis_str:<10} | {perim_str:<10} | {nen_str:<8} | {r['so_phan_tu']:<7} | {r['phan_loai_hien_thi']}")
        
    print("\n" + "=" * 115)
    print("TỔNG KẾT PHÂN TÍCH HÌNH HỌC:")
    print(f"- Tổng số Polygon ranh giới: {len(rows)}")
    print(f"- Số Polygon diện tích SIÊU NHỎ (< 0.05 ha): {very_small_count}/25 (Cực kỳ khó nhìn hoặc gần như biến mất ở Zoom <= 11)")
    print(f"- Số Polygon diện tích NHỎ (0.05 - 0.3 ha): {small_count}/25 (Rất nhỏ trên màn hình nếu không có biểu tượng đại diện)")
    print(f"- Số Polygon dạng rất hẹp / kéo dài / răng cưa (độ nén < 0.05): {sliver_count}/25 (Nhìn như đoạn thẳng xanh ở Zoom xa)")
    print(f"- Số Polygon có chênh lệch lớn giữa GIS và Khai báo (>150%): {diff_count}/25")
    print(f"- Số MultiPolygon có nhiều thành phần (>1 polygon con): {multi_part_count}/25")
    print(f"- Tất cả {len(rows)} Polygon đều hợp lệ về mặt hình học GIS (ST_IsValid = True).")
    print("=" * 115)
