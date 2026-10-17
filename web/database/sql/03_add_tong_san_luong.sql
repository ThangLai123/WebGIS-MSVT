-- ==============================================================================
-- Migration: Bổ sung cột tong_san_luong_tan và CHECK constraint cho bảng public.vung_trong
-- File: database/sql/03_add_tong_san_luong.sql
-- ==============================================================================

-- 1. Thêm cột tong_san_luong_tan (NUMERIC 14,4, cho phép NULL) nếu chưa tồn tại
ALTER TABLE public.vung_trong 
ADD COLUMN IF NOT EXISTS tong_san_luong_tan NUMERIC(14,4);

-- 2. Thêm CHECK constraint đảm bảo giá trị không âm một cách an toàn (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_tong_san_luong_tan' 
        AND conrelid = 'public.vung_trong'::regclass
    ) THEN
        ALTER TABLE public.vung_trong 
        ADD CONSTRAINT check_tong_san_luong_tan 
        CHECK (tong_san_luong_tan IS NULL OR tong_san_luong_tan >= 0);
    END IF;
END $$;
