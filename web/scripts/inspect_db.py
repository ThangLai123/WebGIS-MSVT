"""
Script chẩn đoán cấu trúc PostgreSQL/PostGIS (Read-only Diagnostic Tool).
Liệt kê các bảng, số dòng, index, khóa ngoại, và geometry columns trong schema public.
An toàn tuyệt đối: Không thực hiện bất kỳ thao tác ghi/sửa dữ liệu nào.
"""
import sys
from pathlib import Path

# Đảm bảo import được module từ backend-fastapi dù chạy từ bất kỳ thư mục nào
backend_dir = Path(__file__).resolve().parent.parent / "backend-fastapi"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.database import engine
from sqlalchemy import text

def inspect_db():
    with engine.connect() as conn:
        print("=== BASE TABLES IN PUBLIC SCHEMA ===")
        tables = conn.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """)).fetchall()
        for t in tables:
            tname = t[0]
            if tname == 'spatial_ref_sys':
                continue
            count = conn.execute(text(f'SELECT COUNT(*) FROM public."{tname}"')).scalar()
            print(f"- {tname}: {count} rows")

        print("\n=== INDEXES IN PUBLIC SCHEMA ===")
        indexes = conn.execute(text("""
            SELECT tablename, indexname, indexdef 
            FROM pg_indexes 
            WHERE schemaname = 'public' AND tablename NOT IN ('spatial_ref_sys')
            ORDER BY tablename, indexname;
        """)).fetchall()
        for idx in indexes:
            print(f"- [{idx[0]}] {idx[1]}: {idx[2]}")

        print("\n=== FOREIGN KEYS ===")
        fks = conn.execute(text("""
            SELECT
                tc.table_name, kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            FROM information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
        """)).fetchall()
        for fk in fks:
            print(f"- {fk[0]}.{fk[1]} -> {fk[2]}.{fk[3]}")

        print("\n=== GEOMETRY COLUMNS AND SRID ===")
        geoms = conn.execute(text("""
            SELECT f_table_name, f_geometry_column, coord_dimension, srid, type
            FROM geometry_columns
            WHERE f_table_schema = 'public';
        """)).fetchall()
        for g in geoms:
            print(f"- {g[0]}.{g[1]}: type={g[4]}, srid={g[3]}, dim={g[2]}")

if __name__ == '__main__':
    inspect_db()
