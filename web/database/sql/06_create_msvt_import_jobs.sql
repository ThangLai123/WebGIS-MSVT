-- ==============================================================================
-- 06_create_msvt_import_jobs.sql
-- Dự án: WebGIS Quản lý Mã số Vùng trồng (MSVT)
-- Mục đích: Bảng quản lý phiên và lịch sử nhập dữ liệu Excel (Import Jobs & Audit Log)
-- Tuyệt đối bảo toàn dữ liệu và cấu trúc của bảng public.vung_trong
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.msvt_import_jobs (
    id VARCHAR(50) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64) NOT NULL,
    uploaded_by BIGINT NULL REFERENCES public.admin_users(id) ON DELETE SET NULL,
    sheet_name VARCHAR(100) NULL,
    header_row INTEGER DEFAULT 1,
    data_start_row INTEGER DEFAULT 2,
    mapping_config JSONB NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'uploaded',
    validated_rows JSONB NULL,
    import_result JSONB NULL,
    temp_file_path VARCHAR(500) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    committed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_msvt_import_jobs_status ON public.msvt_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_msvt_import_jobs_created_at ON public.msvt_import_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msvt_import_jobs_uploaded_by ON public.msvt_import_jobs(uploaded_by);

COMMENT ON TABLE public.msvt_import_jobs IS 'Bảng lưu vết các phiên nhập dữ liệu MSVT từ file Excel';
COMMENT ON COLUMN public.msvt_import_jobs.status IS 'Trạng thái phiên nhập: uploaded, validated, committed, cancelled, failed';
