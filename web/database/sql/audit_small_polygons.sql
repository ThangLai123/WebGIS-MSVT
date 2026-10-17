-- audit_small_polygons.sql
-- Truy vấn chỉ đọc (READ-ONLY) để kiểm tra chất lượng dữ liệu không gian Vùng trồng MSVT
-- Trong schema public.vung_trong:
--   vi_tri: Geometry(Point, 4326)
--   ranh_gioi: Geometry(MultiPolygon, 4326)

WITH polygon_metrics AS (
    SELECT 
        id,
        msvt_moi,
        msvt_cu,
        to_chuc_ca_nhan,
        loai_cay_trong,
        dien_tich_ha AS dien_tich_khai_bao,
        ST_GeometryType(ranh_gioi) AS geom_type,
        ST_IsValid(ranh_gioi) AS is_valid,
        ST_IsValidReason(ranh_gioi) AS invalid_reason,
        ROUND((ST_Area(ranh_gioi::geography) / 10000.0)::numeric, 4) AS dien_tich_gis_ha,
        ROUND(ST_Perimeter(ranh_gioi::geography)::numeric, 2) AS chu_vi_gis_m,
        ST_NumGeometries(ranh_gioi) AS so_phan_tu,
        ST_NPoints(ranh_gioi) AS so_dinh,
        ROUND(ST_XMin(ranh_gioi)::numeric, 6) AS min_lng,
        ROUND(ST_YMin(ranh_gioi)::numeric, 6) AS min_lat,
        ROUND(ST_XMax(ranh_gioi)::numeric, 6) AS max_lng,
        ROUND(ST_YMax(ranh_gioi)::numeric, 6) AS max_lat,
        ROUND((ST_XMax(ranh_gioi) - ST_XMin(ranh_gioi))::numeric, 6) AS do_rong_deg,
        ROUND((ST_YMax(ranh_gioi) - ST_YMin(ranh_gioi))::numeric, 6) AS do_cao_deg
    FROM public.vung_trong
    WHERE ranh_gioi IS NOT NULL 
      AND is_deleted = false
),
polygon_analysis AS (
    SELECT 
        *,
        -- Isoperimetric quotient = 4 * PI * Area / (Perimeter^2)
        -- Giá trị gần 1 là hình tròn/vuông đều, giá trị < 0.1 là hình rất dài, hẹp hoặc răng cưa
        CASE 
            WHEN chu_vi_gis_m > 0 THEN 
                ROUND((4 * PI() * (dien_tich_gis_ha * 10000.0) / (chu_vi_gis_m * chu_vi_gis_m))::numeric, 4)
            ELSE 0 
        END AS chi_so_do_nen,
        -- Tỷ lệ chênh lệch giữa diện tích GIS tính toán và diện tích khai báo
        CASE 
            WHEN dien_tich_khai_bao > 0 AND dien_tich_gis_ha > 0 THEN 
                ROUND(ABS(dien_tich_gis_ha - dien_tich_khai_bao) / dien_tich_khai_bao, 2)
            ELSE NULL 
        END AS ty_le_lech_dien_tich,
        -- Cảnh báo phạm vi Nghệ An
        CASE 
            WHEN min_lng < 103.5 OR max_lng > 106.0 OR min_lat < 18.5 OR max_lat > 20.0 THEN true
            ELSE false
        END AS ngoai_pham_vi_nghe_an
    FROM polygon_metrics
)
SELECT 
    id,
    msvt_moi,
    loai_cay_trong,
    dien_tich_khai_bao,
    dien_tich_gis_ha,
    chu_vi_gis_m,
    so_dinh,
    so_phan_tu,
    chi_so_do_nen,
    ty_le_lech_dien_tich,
    is_valid,
    invalid_reason,
    ngoai_pham_vi_nghe_an,
    CASE 
        WHEN dien_tich_gis_ha < 0.05 THEN 'DIỆN TÍCH RẤT NHỎ (<0.05 ha)'
        WHEN dien_tich_gis_ha < 0.3 THEN 'DIỆN TÍCH NHỎ (<0.3 ha)'
        WHEN chi_so_do_nen < 0.05 THEN 'HÌNH RẤT DÀI HẸP / RĂNG CƯA'
        WHEN ty_le_lech_dien_tich > 2.0 THEN 'CHÊNH LỆCH DIỆN TÍCH > 200%'
        WHEN so_phan_tu > 1 THEN 'MULTIPOLYGON NHIỀU THÀNH PHẦN'
        ELSE 'BÌNH THƯỜNG'
    END AS phan_loai_hien_thi
FROM polygon_analysis
ORDER BY dien_tich_gis_ha ASC;
