-- ==============================================================================
-- 05_add_soft_delete_vung_trong.sql
-- Dự án: WebGIS Quản lý Mã số Vùng trồng (MSVT)
-- Mục đích: Bổ sung các trường xóa mềm (Soft Delete) cho bảng public.vung_trong
-- ==============================================================================

-- 1. Bổ sung các cột xóa mềm
ALTER TABLE public.vung_trong
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL;

-- 2. Thêm khóa ngoại liên kết tới người thực hiện xóa (admin_users)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_vung_trong_deleted_by'
    ) THEN
        ALTER TABLE public.vung_trong
            ADD CONSTRAINT fk_vung_trong_deleted_by
            FOREIGN KEY (deleted_by)
            REFERENCES public.admin_users(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Tạo index phục vụ lọc bản ghi chưa bị xóa mềm
CREATE INDEX IF NOT EXISTS idx_vung_trong_is_deleted 
    ON public.vung_trong(is_deleted);

-- 4. Chú thích tài liệu
COMMENT ON COLUMN public.vung_trong.is_deleted IS 'Cờ đánh dấu xóa mềm (true: đã xóa, false: đang hoạt động)';
COMMENT ON COLUMN public.vung_trong.deleted_at IS 'Thời điểm bản ghi bị xóa mềm';
COMMENT ON COLUMN public.vung_trong.deleted_by IS 'ID của tài khoản admin thực hiện thao tác xóa mềm';
