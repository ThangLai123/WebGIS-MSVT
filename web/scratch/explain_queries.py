import sys
sys.path.insert(0, r"d:\DuDoanGiaDat\web\backend-fastapi")
from app.database import engine
from sqlalchemy import text

def explain_queries():
    with engine.connect() as conn:
        print("=== EXPLAIN ANALYZE: GeoJSON Query ===")
        geojson_plan = conn.execute(text("""
            EXPLAIN ANALYZE
            SELECT id, msvt_moi, loai_cay_trong, thi_truong, ST_AsGeoJSON(ranh_gioi)
            FROM public.vung_trong
            WHERE is_deleted = false AND ranh_gioi IS NOT NULL;
        """)).fetchall()
        for row in geojson_plan:
            print(row[0])

        print("\n=== EXPLAIN ANALYZE: ST_Covers Spatial Query ===")
        # Test point near Thai Hoa / Dien Chau
        lookup_plan = conn.execute(text("""
            EXPLAIN ANALYZE
            SELECT id, msvt_moi, loai_cay_trong
            FROM public.vung_trong
            WHERE is_deleted = false
              AND ranh_gioi IS NOT NULL
              AND ST_Covers(ranh_gioi, ST_SetSRID(ST_Point(105.5758, 19.1808), 4326));
        """)).fetchall()
        for row in lookup_plan:
            print(row[0])

if __name__ == '__main__':
    explain_queries()
